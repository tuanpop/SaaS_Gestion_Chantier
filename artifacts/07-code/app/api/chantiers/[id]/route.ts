// app/api/chantiers/[id]/route.ts
// GET /api/chantiers/[id] — détail chantier (admin + conducteur)
// PATCH /api/chantiers/[id] — modifier chantier (admin uniquement)
// DELETE /api/chantiers/[id] — archiver chantier (soft delete, admin uniquement)
//
// Implémente : US-010 S1 (détail), US-010 S2 (modification), archivage
// Items sécurité : T-01 (JWT claims), T-02 (ownership), I-01 (RLS), I-06 (404 hors périmètre)
//
// Note TS (pattern Bug A — Zoro 2026-05-15) :
//   Reads : createClient() + cast 'as unknown as' (RLS actif)
//   Writes : createAdminClient() + filtre organisation_id explicit (isolation manuelle)
//   createClient<Database> (createServerClient) résout les nouvelles tables Sprint 2 comme never.
//   createClient de @supabase/supabase-js (admin) résout correctement.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { canAccessChantier } from '@/lib/chantier-access'
import { calculerCouleur } from '@/lib/coloration'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { insertNotification, resolveAdminsOrg, resolveConducteurChantier } from '@/lib/notifications/notif'
import { resolverDerivesChantier } from '@/lib/detection/resolverDerives'
import type {
  UserRole,
  Chantier,
  TacheWithUser,
  AffectationWithUser,
  ChantierWithColoration,
  TablesUpdate,
} from '@/types/database'

// ============================================================
// Schémas Zod
// ============================================================

const UpdateChantierSchema = z
  .object({
    nom: z.string().min(1).max(100).optional(),
    client_nom: z.string().min(1).max(200).optional(),
    adresse: z.string().min(1).max(500).optional(),
    code_postal: z.string().regex(/^\d{5}$/).optional(),
    budget_alloue: z.number().positive().optional(),
    budget_depense: z.number().min(0).optional(),
    date_debut: z.string().date().optional(),
    date_fin_prevue: z.string().date().optional(),
    date_fin_reelle: z.string().date().nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.date_debut && data.date_fin_prevue) {
        return data.date_fin_prevue >= data.date_debut
      }
      return true
    },
    {
      message: 'date_fin_prevue doit être >= date_debut',
      path: ['date_fin_prevue'],
    },
  )

// ============================================================
// GET /api/chantiers/[id]
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'GET /api/chantiers/[id]' })

  try {
    const { id: chantierId } = await params

    // 1. Extraire claims depuis headers (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    const supabase = await createClient()

    // 2. Vérifier accès — I-06 : même réponse si inexistant ou hors périmètre
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

    // 3. Récupérer le chantier (adminClient résout les types correctement)
    const adminClient = createAdminClient()

    const { data: chantier, error: chantierError } = await adminClient
      .from('chantiers')
      .select('*')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (chantierError || !chantier) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    const chantierTyped = chantier as unknown as Chantier

    // 4. Récupérer les tâches associées
    const { data: tachesRaw, error: tachesError } = await adminClient
      .from('taches')
      .select(`
        id, chantier_id, organisation_id, titre, description,
        statut, assigned_to, date_echeance, bloque_raison, created_by, created_at, updated_at,
        assigned_user:users!taches_assigned_to_fkey (nom, prenom)
      `)
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId)
      .order('created_at', { ascending: true })

    if (tachesError) {
      reqLogger.error(
        { error: tachesError.message, chantierId },
        'Erreur lecture tâches du chantier',
      )
    }

    const taches = (tachesRaw ?? []) as unknown as TacheWithUser[]

    // 5. Récupérer les affectations
    const { data: affectationsRaw, error: affectationsError } = await adminClient
      .from('affectations')
      .select(`
        id, user_id, chantier_id, organisation_id, vue, date_debut, date_fin, created_by, created_at,
        user:users!affectations_user_id_fkey (nom, prenom, role)
      `)
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId)
      .order('created_at', { ascending: true })

    if (affectationsError) {
      reqLogger.error(
        { error: affectationsError.message, chantierId },
        'Erreur lecture affectations du chantier',
      )
    }

    const affectations = (affectationsRaw ?? []) as unknown as AffectationWithUser[]

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

    return NextResponse.json(
      {
        ...chantierColore,
        taches,
        affectations,
      },
      { status: 200 },
    )
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// PATCH /api/chantiers/[id] — admin uniquement
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'PATCH /api/chantiers/[id]' })

  try {
    const { id: chantierId } = await params

    // 1. Claims (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Admin uniquement pour PATCH
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const supabase = await createClient()

    // 3. assertTrialActive — D-012
    await assertTrialActive(supabase, organisationId)

    // 4. Valider input EN PREMIER (fail fast — avant tout accès DB)
    // Ordre inversé vs original pour éviter les DB calls inutiles sur inputs invalides.
    // Les tests chantiers-id-rbac PATCH-4/PATCH-5 vérifient ce comportement (regression guard).
    const body: unknown = await request.json()
    const parsed = UpdateChantierSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Requête invalide.',
          fields: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json(
        { error: 'Aucun champ à mettre à jour.' },
        { status: 400 },
      )
    }

    const adminClient = createAdminClient()

    // 5. Vérifier ownership — I-06 (404 si hors org)
    // D-4V-006 : étendre le SELECT pour lire les données AVANT UPDATE (couleur avant)
    // AUDIT: SELECT explicite — note_privee_conducteur non sélectionné (K4V-09)
    const { data: existing, error: existingError } = await adminClient
      .from('chantiers')
      .select('id, nom, budget_alloue, budget_depense, date_fin_prevue')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (existingError || !existing) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    // Calculer couleur AVANT UPDATE (D-4V-006, ADR-4V-002)
    const existingTyped = existing as unknown as {
      id: string
      nom: string
      budget_alloue: number | null
      budget_depense: number
      date_fin_prevue: string
    }
    const couleurAvant = calculerCouleur(
      {
        date_fin_prevue: existingTyped.date_fin_prevue,
        budget_alloue: existingTyped.budget_alloue,
        budget_depense: existingTyped.budget_depense,
      },
      new Date(),
    )

    // 6. Mettre à jour
    // Filtrer les `undefined` (exactOptionalPropertyTypes attend `key?: T`, pas `T | undefined`),
    // puis caster vers le type Update officiel de la table chantiers.
    type ChantierUpdate = TablesUpdate<'chantiers'>
    const updatePayload = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as ChantierUpdate

    const { data, error } = await adminClient
      .from('chantiers')
      .update(updatePayload)
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .select()
      .single()

    if (error || !data) {
      reqLogger.error(
        { error: error?.message, chantierId, organisationId },
        'Erreur mise à jour chantier',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    const dataTyped = data as unknown as Chantier

    const chantierColore: ChantierWithColoration = {
      ...dataTyped,
      couleur: calculerCouleur(
        {
          date_fin_prevue: dataTyped.date_fin_prevue,
          budget_alloue: dataTyped.budget_alloue,
          budget_depense: dataTyped.budget_depense,
        },
        new Date(),
      ),
    }

    reqLogger.info({ chantierId }, 'Chantier mis à jour')

    // D-4V-006, RG-NOTIF-EVT-008 : détection dérive budget (couleur avant vs après)
    // Condition : bascule couleur ET axe budget (budget_depense > budget_alloue après UPDATE)
    const couleurApres = chantierColore.couleur
    const budgetDepenseApres = dataTyped.budget_depense
    const budgetAlloueApres = dataTyped.budget_alloue

    if (
      couleurAvant !== couleurApres &&
      (couleurApres === 'orange' || couleurApres === 'rouge') &&
      budgetAlloueApres !== null &&
      budgetDepenseApres > budgetAlloueApres
    ) {
      // Destinataires : admins de l'org + conducteur du chantier (D-4V-006, RG-NOTIF-EVT-008)
      const [admins, conducteurId] = await Promise.all([
        resolveAdminsOrg(adminClient, organisationId),
        resolveConducteurChantier(adminClient, chantierId, organisationId),
      ])

      // Déduplication destinataires (conducteur peut aussi être admin dans certains setups)
      const destinataires = [...new Set([...admins, ...(conducteurId ? [conducteurId] : [])])]

      // RG-NOTIF-EVT-009 : message dérive budget
      const notifTitre = `Dérive budget — ${dataTyped.nom}`
      const notifMessage = `Le budget du chantier « ${dataTyped.nom} » dépasse le budget alloué (dépensé : ${budgetDepenseApres} € / alloué : ${budgetAlloueApres} €).`

      for (const destinataireId of destinataires) {
        await insertNotification({
          organisationId,
          userId: destinataireId,
          type: 'derive_budget',
          titre: notifTitre,
          message: notifMessage,
          chantierId,
          tacheId: null,
        })
      }
    }

    return NextResponse.json(chantierColore, { status: 200 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// DELETE /api/chantiers/[id] — soft delete, admin uniquement (D-013 RGPD)
// ============================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'DELETE /api/chantiers/[id]' })

  try {
    const { id: chantierId } = await params

    // 1. Claims (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Admin uniquement
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const supabase = await createClient()

    // 3. assertTrialActive — D-012
    await assertTrialActive(supabase, organisationId)

    const adminClient = createAdminClient()

    // 4. Vérifier ownership — I-06
    const { data: existing, error: existingError } = await adminClient
      .from('chantiers')
      .select('id, statut')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (existingError || !existing) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    // 5. Soft delete : UPDATE statut = 'archive' + date_fin_reelle = today
    // Ne pas DELETE physiquement (données historiques conservées — D-013 RGPD)
    const today = new Date().toISOString().split('T')[0] as string // YYYY-MM-DD

    const { error } = await adminClient
      .from('chantiers')
      .update({
        statut: 'archive',
        date_fin_reelle: today,
      })
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)

    if (error) {
      reqLogger.error(
        { error: error.message, chantierId },
        'Erreur archivage chantier',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    reqLogger.info({ chantierId, userId }, 'Chantier archivé (soft delete)')

    // D-6-11 / TST-K6-24 : résoudre les dérives actives du chantier archivé (best-effort)
    // Après l'UPDATE du chantier — ne bloque JAMAIS l'archivage en cas d'erreur.
    //
    // Note d'alignement architectural (Zoro 2026-06-16, F003 Itachi Phase 4) :
    // L'architecture D-6-11 décrit "PATCH /api/chantiers/[id] posant statut='archive' appelle
    // resolverDerivesChantier". Dans l'implémentation réelle, le soft delete (statut='archive')
    // est effectué ici dans DELETE, pas dans PATCH (PATCH ne modifie pas le statut).
    // Voir DECISIONLOG entrée Amelia 2026-06-16 (permanent:false) et Zoro 2026-06-16.
    // Levi : tester TST-K6-24 via DELETE /api/chantiers/[id], pas PATCH.
    try {
      await resolverDerivesChantier(chantierId, adminClient)
    } catch (resolverErr) {
      // Best-effort strict : log warn, ne propage jamais l'erreur (TST-K6-24)
      reqLogger.warn(
        { chantierId, error: resolverErr instanceof Error ? resolverErr.message : String(resolverErr) },
        'resolverDerivesChantier failed — archivage non bloqué (best-effort)',
      )
    }

    // Sprint 8 — Cascade archivage chat (best-effort total)
    // D-8-10 BINDING : cascade non-bloquante — erreur = log warn, archivage continue
    // Étape 1 : message système dans le chat du chantier
    // Étape 2 : rejeter les propositions pending (plus de contexte actif)
    try {
      const { data: chatRow } = await adminClient
        .from('chats')
        .select('id')
        .eq('chantier_id', chantierId)
        .eq('organisation_id', organisationId)
        .maybeSingle() as unknown as { data: { id: string } | null; error: unknown }

      if (chatRow?.id) {
        // Étape 1 : message système "chantier archivé"
        await (adminClient as unknown as ReturnType<typeof createAdminClient>)
          .from('messages')
          .insert({
            chat_id: chatRow.id,
            chantier_id: chantierId,
            auteur_id: null,
            auteur_nom: 'Système',
            auteur_role: null,
            type: 'system',
            contenu: 'Ce chantier a été archivé. Le chat est désormais en lecture seule.',
            deleted_at: null,
            action_proposal_id: null,
          } as unknown as import('@/types/database').Database['public']['Tables']['messages']['Insert'])

        reqLogger.debug({ chantierId, chatId: chatRow.id }, 'Sprint 8 cascade: message système archivage inséré')
      }

      // Étape 2 : rejeter toutes les propositions pending du chantier
      const { error: rejectError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
        .from('action_proposals')
        .update({ statut: 'rejete' } as unknown as import('@/types/database').Database['public']['Tables']['action_proposals']['Update'])
        .eq('chantier_id', chantierId)
        .eq('organisation_id', organisationId)
        .eq('statut', 'pending') as unknown as { error: { message: string } | null }

      if (rejectError) {
        reqLogger.warn(
          { chantierId, error: rejectError.message },
          'Sprint 8 cascade: erreur rejet propositions pending (non-bloquant)',
        )
      } else {
        reqLogger.debug({ chantierId }, 'Sprint 8 cascade: propositions pending rejetées')
      }
    } catch (cascadeErr) {
      reqLogger.warn(
        {
          chantierId,
          error: cascadeErr instanceof Error ? cascadeErr.message : String(cascadeErr),
        },
        'Sprint 8 cascade archivage chat: erreur inattendue (non-bloquante)',
      )
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
