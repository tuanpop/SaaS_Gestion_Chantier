// app/api/chantiers/route.ts
// GET /api/chantiers — liste chantiers actifs (admin + conducteur)
// POST /api/chantiers — créer un chantier (admin uniquement)
//
// Implémente : US-010 S1 (création), US-010 S2 (validation code_postal), US-010 S3 (liste < 1s)
// Items sécurité : T-01 (organisation_id depuis JWT), I-01 (RLS), D-012 (trial-gate), I-03 (no stack trace)
//
// Note TS : les opérations sur les nouvelles tables Sprint 2 nécessitent un cast via un client admin
// ou un cast chirurgical. On utilise le createAdminClient pour les opérations d'écriture sur
// les nouvelles tables car createServerClient<Database> résout certains types Sprint 2 comme never
// (même problème que Bug A — Zoro 2026-05-15). La RLS est maintenue côté Supabase via le filtre explicite
// sur organisation_id dans toutes les queries (defense en profondeur).
// Alternative : cast `as unknown as` — utilisé pour les reads; adminClient pour les writes.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { calculerCouleur, trierParCouleur } from '@/lib/coloration'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { CreateChantierSchema } from '@/lib/validation/chantiers'
import type {
  UserRole,
  Chantier,
  ChantierWithColoration,
} from '@/types/database'

// ============================================================
// GET /api/chantiers
// ============================================================

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'GET /api/chantiers' })

  try {
    // 1. Extraire claims depuis headers injectés par le middleware (T-01 — jamais depuis req.body)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401 },
      )
    }

    // Utiliser le client serveur pour la lecture (RLS + cookies session)
    const supabase = await createClient()

    // Cast chirurgical — pattern Sprint 1 (Zoro Bug A) : createServerClient résout certains types comme never
    type AffectationRow = { chantier_id: string }
    let affectedChantierIds: string[] = []

    // Q1 (2026-05-15) : conducteur voit uniquement ses chantiers (créateur OU affecté)
    if (role === 'conducteur') {
      const { data: affectations, error: affectError } = await supabase
        .from('affectations')
        .select('chantier_id')
        .eq('user_id', userId)
        .eq('organisation_id', organisationId) as unknown as {
          data: AffectationRow[] | null
          error: { message: string } | null
        }

      if (affectError) {
        reqLogger.error(
          { error: affectError.message, userId },
          'Erreur lecture affectations conducteur',
        )
        return NextResponse.json(
          { error: 'Une erreur interne est survenue.' },
          { status: 500 },
        )
      }

      affectedChantierIds = (affectations ?? []).map((a) => a.chantier_id)
    }

    // Construire la query de base
    // Cast sur la table chantiers (nouvelles tables Sprint 2 = never avec createServerClient)
    type ChantierQuery = ReturnType<typeof supabase.from> & {
      select: (cols: string) => ChantierQuery
      eq: (col: string, val: string) => ChantierQuery
      or: (filter: string) => ChantierQuery
      order: (col: string, opts: { ascending: boolean }) => Promise<{
        data: Chantier[] | null
        error: { message: string } | null
      }>
    }

    let baseQuery = supabase
      .from('chantiers')
      .select('*')
      .eq('organisation_id', organisationId)
      .eq('statut', 'actif') as unknown as ChantierQuery

    // Filtre conducteur
    if (role === 'conducteur') {
      if (affectedChantierIds.length > 0) {
        baseQuery = baseQuery.or(
          `created_by.eq.${userId},id.in.(${affectedChantierIds.join(',')})`,
        )
      } else {
        // Aucune affectation — uniquement ses créations
        baseQuery = (baseQuery as unknown as {
          eq: (col: string, val: string) => ChantierQuery
        }).eq('created_by', userId)
      }
    }

    // Tri DB par date_fin_prevue pour utiliser idx_chantiers_statut_date (DoD US-010 S3 < 1s)
    const { data: chantiers, error } = await baseQuery.order(
      'date_fin_prevue',
      { ascending: true },
    )

    if (error) {
      reqLogger.error(
        { error: error.message, organisationId },
        'Erreur lecture chantiers',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    const aujourdhui = new Date()

    // Calculer la couleur côté serveur (B.1) et trier rouge > orange > vert
    const chantiersColores: ChantierWithColoration[] = (chantiers ?? []).map(
      (c: Chantier) => ({
        ...c,
        couleur: calculerCouleur(
          {
            date_fin_prevue: c.date_fin_prevue,
            budget_alloue: c.budget_alloue,
            budget_depense: c.budget_depense,
          },
          aujourdhui,
        ),
      }),
    )

    const chantiersTriés = trierParCouleur(chantiersColores)

    reqLogger.debug(
      { count: chantiersTriés.length, role, userId },
      'Chantiers récupérés',
    )

    return NextResponse.json(chantiersTriés, { status: 200 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// POST /api/chantiers — admin uniquement
// ============================================================

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'POST /api/chantiers' })

  try {
    // 1. Extraire claims depuis headers injectés par le middleware (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401 },
      )
    }

    // 2. Vérifier rôle admin — seul l'admin peut créer un chantier
    if (role !== 'admin') {
      return NextResponse.json(
        { error: 'Accès refusé.' },
        { status: 403 },
      )
    }

    // Utiliser le client serveur pour le check trial-gate (a besoin des cookies RLS)
    const supabase = await createClient()

    // 3. assertTrialActive — D-012 (trial-gate sur toutes mutations)
    await assertTrialActive(supabase, organisationId)

    // 4. Parser et valider l'input
    const body: unknown = await request.json()
    const parsed = CreateChantierSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Requête invalide.',
          fields: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    // 5. Insérer le chantier via adminClient (contourne le problème de types never Sprint 2)
    // Sécurité maintenue : organisation_id UNIQUEMENT depuis JWT (T-01), filtre explicit sur insert
    // DANGER : adminClient bypasse RLS — l'isolation est garantie par l'injection manuelle de organisation_id
    const adminClient = createAdminClient()

    // Contournement : exactOptionalPropertyTypes=true + Zod génère T | undefined pour les optionnels
    // On normalise undefined -> null avant l'insert. Cast chirurgical documenté DECISIONLOG.md [2026-05-15].
    const insertChantierPayload = {
      nom: parsed.data.nom,
      client_nom: parsed.data.client_nom,
      adresse: parsed.data.adresse,
      code_postal: parsed.data.code_postal,
      date_debut: parsed.data.date_debut,
      date_fin_prevue: parsed.data.date_fin_prevue,
      budget_alloue: parsed.data.budget_alloue ?? null,
      organisation_id: organisationId,
      created_by: userId,
    }

    const { data, error } = await adminClient
      .from('chantiers')
      .insert(insertChantierPayload as unknown as { nom: string; client_nom: string; adresse: string; code_postal: string; date_debut: string; date_fin_prevue: string; budget_alloue: number | null; organisation_id: string; created_by: string })
      .select()
      .single()

    if (error || !data) {
      reqLogger.error(
        { error: error?.message, organisationId, userId },
        'Erreur création chantier',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    // 6. Sprint 8 : INSERT chat automatiquement (best-effort — ne bloque pas la création du chantier)
    // specs.md : POST /api/chantiers "crée aussi le chat automatiquement" (US-066)
    // D-8-16 BINDING : best-effort total — erreur chat = log warn, pas d'erreur vers le client
    try {
      const { error: chatError } = await adminClient
        .from('chats')
        .insert({
          chantier_id: (data as unknown as { id: string }).id,
          organisation_id: organisationId,
        } as unknown as { chantier_id: string; organisation_id: string })

      if (chatError) {
        reqLogger.warn(
          { error: chatError.message, chantierId: (data as unknown as { id: string }).id },
          'POST chantiers: erreur création chat automatique (non-bloquant)',
        )
      } else {
        reqLogger.debug(
          { chantierId: (data as unknown as { id: string }).id },
          'POST chantiers: chat créé automatiquement',
        )
      }
    } catch (chatErr) {
      reqLogger.warn(
        { error: chatErr instanceof Error ? chatErr.message : String(chatErr) },
        'POST chantiers: exception création chat (non-bloquant)',
      )
    }

    // 7. Retourner le chantier créé avec coloration -> HTTP 201
    const chantierTyped = data as unknown as Chantier
    const chantierColore: ChantierWithColoration = {
      ...chantierTyped,
      couleur: calculerCouleur(
        {
          date_fin_prevue: chantierTyped.date_fin_prevue,
          budget_alloue: chantierTyped.budget_alloue,
          budget_depense: chantierTyped.budget_depense,
        },
        new Date(),
      ),
    }

    reqLogger.info(
      { chantierId: chantierTyped.id, organisationId },
      'Chantier créé',
    )

    return NextResponse.json(chantierColore, { status: 201 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
