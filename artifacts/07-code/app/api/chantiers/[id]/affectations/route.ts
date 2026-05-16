// app/api/chantiers/[id]/affectations/route.ts
// GET /api/chantiers/[id]/affectations — liste affectations du chantier (admin + conducteur)
// POST /api/chantiers/[id]/affectations — affecter un utilisateur au chantier (conducteur + admin)
//
// Implémente : US-004 S1 (affectation nominale), DoD (cross-org check)
// Q2 (2026-05-15) : user_id accepte role IN ('ouvrier', 'conducteur') — pas seulement ouvrier
// Items sécurité : T-01 (JWT), I-01 (RLS via canAccessChantier), D-012, I-06
//
// Note TS (pattern Bug A — Zoro 2026-05-15) :
//   Reads : createClient() (RLS) pour la vérification d'accès
//   Writes : createAdminClient() + filtres explicit organisation_id

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { canAccessChantier } from '@/lib/chantier-access'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { UserRole, AffectationWithUser } from '@/types/database'

// ============================================================
// Schéma Zod
// ============================================================

const CreateAffectationSchema = z
  .object({
    user_id: z.string().uuid(),
    date_debut: z.string().date(),
    date_fin: z.string().date().nullable().optional(),
    vue: z.enum(['mes_taches', 'chantier_complet']).default('mes_taches'),
  })
  .refine(
    (data) => !data.date_fin || data.date_fin >= data.date_debut,
    {
      message: 'date_fin doit être >= date_debut',
      path: ['date_fin'],
    },
  )

// ============================================================
// GET /api/chantiers/[id]/affectations
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/chantiers/[id]/affectations',
  })

  try {
    const { id: chantierId } = await params

    // 1. Claims (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    const supabase = await createClient()

    // 2. Vérifier accès au chantier (admin = toute l'org, conducteur = ses chantiers)
    const hasAccess = await canAccessChantier(
      supabase,
      chantierId,
      organisationId,
      userId,
      role,
    )
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    // 3. Récupérer toutes les affectations du chantier avec infos utilisateur
    const adminClient = createAdminClient()
    const { data: affectations, error } = await adminClient
      .from('affectations')
      .select(`
        id, user_id, chantier_id, organisation_id, vue, date_debut, date_fin, created_by, created_at,
        user:users!affectations_user_id_fkey (nom, prenom, role)
      `)
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId)
      .order('created_at', { ascending: true })

    if (error) {
      reqLogger.error(
        { error: error.message, chantierId },
        'Erreur lecture affectations',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    return NextResponse.json(
      (affectations ?? []) as unknown as AffectationWithUser[],
      { status: 200 },
    )
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// POST /api/chantiers/[id]/affectations — conducteur et admin
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'POST /api/chantiers/[id]/affectations',
  })

  try {
    const { id: chantierId } = await params

    // 1. Claims (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Conducteur ou admin uniquement pour affecter
    if (role !== 'conducteur' && role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const supabase = await createClient()

    // 3. assertTrialActive — D-012
    await assertTrialActive(supabase, organisationId)

    // 4. Valider schema
    const body: unknown = await request.json()
    const parsed = CreateAffectationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Requête invalide.',
          fields: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    // 5. Vérifier accès au chantier (conducteur = ses chantiers uniquement)
    const hasAccess = await canAccessChantier(
      supabase,
      chantierId,
      organisationId,
      userId,
      role,
    )
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    const adminClient = createAdminClient()

    // 6. Vérifier que user_id appartient à la MÊME organisation (DoD US-004 cross-org)
    // I-06 : même réponse 403 si l'utilisateur n'existe pas ou est hors org
    const { data: targetUser, error: userError } = await adminClient
      .from('users')
      .select('id, role')
      .eq('id', parsed.data.user_id)
      .eq('organisation_id', organisationId)
      .single()

    if (userError || !targetUser) {
      reqLogger.warn(
        { userId: parsed.data.user_id, organisationId },
        'Tentative affectation utilisateur hors organisation',
      )
      return NextResponse.json(
        { error: 'Accès refusé.' },
        { status: 403 },
      )
    }

    // 7. Vérifier que l'utilisateur cible a un rôle affectable
    // Q2 (2026-05-15) : ouvrier OU conducteur (pas admin — l'admin gère, n'exécute pas)
    if (targetUser.role === 'admin') {
      reqLogger.warn(
        { targetUserId: parsed.data.user_id, role: targetUser.role },
        "Tentative affectation d'un admin",
      )
      return NextResponse.json(
        {
          error: 'Requête invalide.',
          fields: {
            user_id: ["Un administrateur ne peut pas être affecté à un chantier."],
          },
        },
        { status: 400 },
      )
    }

    // 8. INSERT affectation — organisation_id depuis JWT uniquement (T-01)
    const { data: affectation, error: insertError } = await adminClient
      .from('affectations')
      .insert({
        user_id: parsed.data.user_id,
        chantier_id: chantierId,
        organisation_id: organisationId,
        vue: parsed.data.vue,
        date_debut: parsed.data.date_debut,
        date_fin: parsed.data.date_fin ?? null,
        created_by: userId,
      })
      .select(`
        id, user_id, chantier_id, organisation_id, vue, date_debut, date_fin, created_by, created_at,
        user:users!affectations_user_id_fkey (nom, prenom, role)
      `)
      .single()

    if (insertError || !affectation) {
      reqLogger.error(
        { error: insertError?.message, chantierId, userId },
        'Erreur création affectation',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    const affectationTyped = affectation as unknown as AffectationWithUser

    reqLogger.info(
      {
        affectationId: affectationTyped.id,
        chantierId,
        targetUserId: parsed.data.user_id,
      },
      'Affectation créée',
    )

    return NextResponse.json(affectationTyped, { status: 201 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
