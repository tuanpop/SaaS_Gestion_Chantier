// app/api/chantiers/[id]/taches/route.ts
// GET /api/chantiers/[id]/taches — liste tâches du chantier (admin + conducteur)
// POST /api/chantiers/[id]/taches — créer une tâche (admin + conducteur)
//
// Implémente : US-011 S1 (création tâche + assignation), US-011 DoD (validation Zod)
// Q4 (2026-05-15) : notification in-app stubée // TODO Sprint 4
// Items sécurité : T-01, T-02, I-01, I-06, D-012
//
// Note TS : adminClient pour les opérations sur taches (pattern Bug A — Zoro 2026-05-15)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { canAccessChantier } from '@/lib/chantier-access'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { UserRole, TacheWithUser } from '@/types/database'

// ============================================================
// Schéma Zod
// ============================================================

const CreateTacheSchema = z
  .object({
    titre: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    date_echeance: z.string().date().nullable().optional(),
    statut: z
      .enum(['a_faire', 'en_cours', 'termine', 'bloque'])
      .default('a_faire'),
    bloque_raison: z.string().min(10).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.statut === 'bloque') {
        return (
          data.bloque_raison !== null &&
          data.bloque_raison !== undefined &&
          data.bloque_raison.length >= 10
        )
      }
      return true
    },
    {
      message: 'bloque_raison obligatoire (min 10 car.) si statut=bloque',
      path: ['bloque_raison'],
    },
  )

// ============================================================
// GET /api/chantiers/[id]/taches
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/chantiers/[id]/taches',
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

    // 2. Vérifier accès au chantier
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

    // 3. Récupérer les tâches avec infos utilisateur assigné
    const adminClient = createAdminClient()
    const { data: taches, error } = await adminClient
      .from('taches')
      .select(`
        id, chantier_id, organisation_id, titre, description,
        statut, assigned_to, date_echeance, bloque_raison, created_by, created_at, updated_at,
        assigned_user:users!taches_assigned_to_fkey (nom, prenom)
      `)
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId)
      .order('created_at', { ascending: true })

    if (error) {
      reqLogger.error(
        { error: error.message, chantierId },
        'Erreur lecture tâches',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    return NextResponse.json(
      (taches ?? []) as unknown as TacheWithUser[],
      { status: 200 },
    )
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// POST /api/chantiers/[id]/taches — admin et conducteur
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'POST /api/chantiers/[id]/taches',
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

    // 2. assertTrialActive — D-012
    await assertTrialActive(supabase, organisationId)

    // 3. Valider schema
    const body: unknown = await request.json()
    const parsed = CreateTacheSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Requête invalide.',
          fields: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    // 4. Vérifier accès au chantier (conducteur = ses chantiers)
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

    // 5. Vérifier que assigned_to (si fourni) appartient à l'organisation
    if (parsed.data.assigned_to) {
      const { data: assignedUser, error: assignedError } = await adminClient
        .from('users')
        .select('id')
        .eq('id', parsed.data.assigned_to)
        .eq('organisation_id', organisationId)
        .single()

      if (assignedError || !assignedUser) {
        return NextResponse.json(
          {
            error: 'Requête invalide.',
            fields: { assigned_to: ['Utilisateur non trouvé dans cette organisation.'] },
          },
          { status: 400 },
        )
      }
    }

    // 6. INSERT tache — organisation_id depuis JWT (T-01), created_by depuis JWT
    const { data: tache, error: insertError } = await adminClient
      .from('taches')
      .insert({
        chantier_id: chantierId,
        organisation_id: organisationId,
        titre: parsed.data.titre,
        description: parsed.data.description ?? null,
        statut: parsed.data.statut,
        assigned_to: parsed.data.assigned_to ?? null,
        date_echeance: parsed.data.date_echeance ?? null,
        bloque_raison: parsed.data.bloque_raison ?? null,
        created_by: userId,
      })
      .select(`
        id, chantier_id, organisation_id, titre, description,
        statut, assigned_to, date_echeance, bloque_raison, created_by, created_at, updated_at,
        assigned_user:users!taches_assigned_to_fkey (nom, prenom)
      `)
      .single()

    if (insertError || !tache) {
      reqLogger.error(
        { error: insertError?.message, chantierId, userId },
        'Erreur création tâche',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    const tacheTyped = tache as unknown as TacheWithUser

    // 7. Si assigned_to fourni : notification in-app (stub Sprint 2)
    if (parsed.data.assigned_to) {
      // TODO Sprint 4 — envoyer notif in-app
      // INSERT INTO notifications (user_id=assigned_to, type='affectation_tache',
      //   payload={tache_id: tacheTyped.id, chantier_id: chantierId}, organisation_id=organisationId)
      // La table notifications sera créée en migration 004_notifications.sql (Sprint 4)
      reqLogger.debug(
        { tacheId: tacheTyped.id, assignedTo: parsed.data.assigned_to },
        'Notification stub — sera implémentée Sprint 4',
      )
    }

    reqLogger.info(
      { tacheId: tacheTyped.id, chantierId },
      'Tâche créée',
    )

    return NextResponse.json(tacheTyped, { status: 201 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
