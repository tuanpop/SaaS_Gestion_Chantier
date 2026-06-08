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
import { insertNotification, resolveConducteurChantier } from '@/lib/notifications/notif'
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

    // 6b. Sprint 3 — Defense double note_privee_conducteur (D-3-013, K3-MED-05)
    // En pratique impossible : les ouvriers n'ont pas de JWT Supabase et ne passent
    // jamais par ce handler. La garde existe pour la defense en profondeur.
    if (parsed.data.note_privee_conducteur !== undefined && role === 'ouvrier') {
      return NextResponse.json(
        { error: 'Accès refusé.' },
        { status: 403 },
      )
    }

    // 7. UPDATE tache (updated_at géré par trigger DB)
    // Filtrer les `undefined` (exactOptionalPropertyTypes attend `key?: T`, pas `T | undefined`),
    // puis caster vers le type Update officiel de la table taches.
    // Sprint 3 : note_privee_conducteur inclus seulement si present dans parsed.data
    type TacheUpdate = TablesUpdate<'taches'>
    const updatePayload = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as TacheUpdate

    // SELECT adapte selon le role — note_privee_conducteur visible conducteur/admin seulement
    // D-3-013, specs §4.6
    const selectFields = role === 'conducteur' || role === 'admin'
      ? `id, chantier_id, organisation_id, titre, description,
         statut, assigned_to, date_echeance, bloque_raison, note_privee_conducteur,
         created_by, created_at, updated_at,
         assigned_user:users!taches_assigned_to_fkey (nom, prenom)`
      : `id, chantier_id, organisation_id, titre, description,
         statut, assigned_to, date_echeance, bloque_raison, created_by, created_at, updated_at,
         assigned_user:users!taches_assigned_to_fkey (nom, prenom)`

    const { data: updated, error: updateError } = await adminClient
      .from('taches')
      .update(updatePayload)
      .eq('id', tacheId)
      .eq('organisation_id', organisationId)
      .select(selectFields)
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

    // 8. Notifications event-based Sprint 4 (D-4V-004, D-4V-005)
    // Appelé APRÈS le commit UPDATE (best-effort — ne peut pas casser le 200)

    // Cas A — statut terminé ou bloqué, ET différent de l'ancien statut (RG-NOTIF-EVT-004/005/006)
    const tacheRow = tache as unknown as { id: string; chantier_id: string; organisation_id: string; statut: string; assigned_to: string | null }
    if (
      parsed.data.statut !== undefined &&
      (parsed.data.statut === 'termine' || parsed.data.statut === 'bloque') &&
      parsed.data.statut !== tacheRow.statut
    ) {
      // AUDIT: SELECT explicite — titre + bloque_raison + chantier nom, note_privee_conducteur JAMAIS sélectionné (K4V-09)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tacheDetail } = await (adminClient as unknown as any)
        .from('taches')
        .select('titre, bloque_raison')
        .eq('id', tacheId)
        .single() as { data: { titre: string; bloque_raison: string | null } | null; error: unknown }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: chantierDetail } = await (adminClient as unknown as any)
        .from('chantiers')
        .select('nom')
        .eq('id', tacheRow.chantier_id)
        .single() as { data: { nom: string } | null; error: unknown }

      const conducteurId = await resolveConducteurChantier(adminClient, tacheRow.chantier_id, organisationId)

      if (tacheDetail && chantierDetail) {
        if (parsed.data.statut === 'termine') {
          await insertNotification({
            organisationId,
            userId: conducteurId ?? '',
            type: 'tache_terminee',
            titre: `Tâche terminée : ${tacheDetail.titre}`,
            message: `La tâche « ${tacheDetail.titre} » sur le chantier « ${chantierDetail.nom} » vient d'être marquée comme terminée.`,
            chantierId: tacheRow.chantier_id,
            tacheId,
          })
        } else if (parsed.data.statut === 'bloque') {
          // Message inclut bloque_raison (public) — JAMAIS note_privee_conducteur (K4V-09)
          const raisonText = tacheDetail.bloque_raison ?? parsed.data.bloque_raison ?? ''
          await insertNotification({
            organisationId,
            userId: conducteurId ?? '',
            type: 'tache_bloquee',
            titre: `Tâche bloquée : ${tacheDetail.titre}`,
            message: `La tâche « ${tacheDetail.titre} » sur le chantier « ${chantierDetail.nom} » est bloquée. Raison : ${raisonText}.`,
            chantierId: tacheRow.chantier_id,
            tacheId,
          })
        }
      }
    }

    // Cas B — ré-assignation vers un nouveau user (RG-NOTIF-EVT-001/003)
    if (
      parsed.data.assigned_to !== undefined &&
      parsed.data.assigned_to !== null &&
      parsed.data.assigned_to !== tacheRow.assigned_to
    ) {
      // AUDIT: SELECT explicite — titre + chantier nom, note_privee_conducteur JAMAIS sélectionné (K4V-09)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tacheDetailB } = await (adminClient as unknown as any)
        .from('taches')
        .select('titre')
        .eq('id', tacheId)
        .single() as { data: { titre: string } | null; error: unknown }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: chantierDetailB } = await (adminClient as unknown as any)
        .from('chantiers')
        .select('nom')
        .eq('id', tacheRow.chantier_id)
        .single() as { data: { nom: string } | null; error: unknown }

      if (tacheDetailB && chantierDetailB) {
        await insertNotification({
          organisationId,
          userId: parsed.data.assigned_to,
          type: 'affectation_tache',
          titre: `Nouvelle tâche assignée : ${tacheDetailB.titre.slice(0, 150)}`,
          message: `Vous avez été assigné à la tâche « ${tacheDetailB.titre} » sur le chantier « ${chantierDetailB.nom} ».`,
          chantierId: tacheRow.chantier_id,
          tacheId,
        })
      }
    }

    reqLogger.info({ tacheId, statut: updatedTyped.statut }, 'Tâche mise à jour')

    return NextResponse.json(updatedTyped, { status: 200 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
