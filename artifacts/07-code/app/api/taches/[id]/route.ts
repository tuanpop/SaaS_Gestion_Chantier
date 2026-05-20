// app/api/taches/[id]/route.ts
// PATCH /api/taches/[id] — modifier une tâche (statut, assignation, raison blocage)
//
// Implémente : US-011 S2 (passage bloqué + raison obligatoire), US-011 S3 (hors périmètre = 404)
// Q4 (2026-05-15) : notification stub // TODO Sprint 4
// Items sécurité : T-01, T-02, I-06 (404 pas 403 si hors org), D-012
//
// Note TS : adminClient pour les opérations sur taches (pattern Bug A — Zoro 2026-05-15)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { UpdateTacheSchema } from '@/lib/validation/taches'
import type { UserRole, TacheWithUser, TablesUpdate } from '@/types/database'

// ============================================================
// PATCH /api/taches/[id]
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'PATCH /api/taches/[id]',
  })

  try {
    const { id: tacheId } = await params

    // 1. Claims (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // 2. Ownership check AVANT assertTrialActive — I-06 : 404 si tâche hors organisation
    const { data: tache, error: tacheError } = await adminClient
      .from('taches')
      .select('id, chantier_id, organisation_id, statut, assigned_to')
      .eq('id', tacheId)
      .eq('organisation_id', organisationId)
      .single()

    if (tacheError || !tache) {
      // I-06 : 404 (pas 403) — ne révèle pas l'existence de la tâche hors organisation
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    // 3. assertTrialActive — D-012
    const supabase = await createClient()
    await assertTrialActive(supabase, organisationId)

    // 4. Valider schema
    const body: unknown = await request.json()
    const parsed = UpdateTacheSchema.safeParse(body)
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

    // 5. Si assigned_to change : vérifier appartenance org + non supprimé
    // Sprint 2 dette (2026-05-20) : `is('deleted_at', null)` — defense-in-depth contre
    // la (ré)assignation à un membre soft-deleted depuis /admin/equipe.
    if (parsed.data.assigned_to !== undefined && parsed.data.assigned_to !== null) {
      const { data: assignedUser, error: assignedError } = await adminClient
        .from('users')
        .select('id')
        .eq('id', parsed.data.assigned_to)
        .eq('organisation_id', organisationId)
        .is('deleted_at', null)
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

    // 6. Double garde bloque_raison — Zod est la garde primaire, vérification ici pour lisibilité
    if (parsed.data.statut === 'bloque') {
      const raisonFutureOrActuelle = parsed.data.bloque_raison
      if (!raisonFutureOrActuelle || raisonFutureOrActuelle.length < 10) {
        return NextResponse.json(
          {
            error: 'Requête invalide.',
            fields: { bloque_raison: ['bloque_raison obligatoire (min 10 car.) si statut=bloque'] },
          },
          { status: 400 },
        )
      }
    }

    // 7. UPDATE tache (updated_at géré par trigger DB)
    // Filtrer les `undefined` (exactOptionalPropertyTypes attend `key?: T`, pas `T | undefined`),
    // puis caster vers le type Update officiel de la table taches.
    type TacheUpdate = TablesUpdate<'taches'>
    const updatePayload = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as TacheUpdate

    const { data: updated, error: updateError } = await adminClient
      .from('taches')
      .update(updatePayload)
      .eq('id', tacheId)
      .eq('organisation_id', organisationId)
      .select(`
        id, chantier_id, organisation_id, titre, description,
        statut, assigned_to, date_echeance, bloque_raison, created_by, created_at, updated_at,
        assigned_user:users!taches_assigned_to_fkey (nom, prenom)
      `)
      .single()

    if (updateError || !updated) {
      reqLogger.error(
        { error: updateError?.message, tacheId },
        'Erreur mise à jour tâche',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    const updatedTyped = updated as unknown as TacheWithUser

    // 8. Notifications stub Sprint 2
    if (parsed.data.statut === 'termine' && updatedTyped.assigned_to) {
      // TODO Sprint 4 — envoyer notif in-app au conducteur
      // INSERT INTO notifications (user_id=<conducteur du chantier>, type='tache_terminee',
      //   payload={tache_id: tacheId, chantier_id: tache.chantier_id}, organisation_id=organisationId)
      reqLogger.debug(
        { tacheId, assignedTo: updatedTyped.assigned_to },
        'Notification conducteur (tâche terminée) — stub Sprint 4',
      )
    }

    if (parsed.data.statut === 'bloque' && updatedTyped.assigned_to) {
      // TODO Sprint 4 — envoyer notif in-app : tâche bloquée
      reqLogger.debug(
        { tacheId, bloque_raison: parsed.data.bloque_raison },
        'Notification tâche bloquée — stub Sprint 4',
      )
    }

    reqLogger.info({ tacheId, statut: updatedTyped.statut }, 'Tâche mise à jour')

    return NextResponse.json(updatedTyped, { status: 200 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
