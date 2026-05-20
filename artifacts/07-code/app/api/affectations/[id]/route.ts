// app/api/affectations/[id]/route.ts
// DELETE /api/affectations/[id] — retirer une affectation (conducteur + admin)
//
// Implémente : specs.md DELETE /api/affectations/[id]
// Items sécurité : T-01 (JWT), T-02 (ownership affectation via organisation_id), D-012
//
// Note TS : adminClient pour les opérations sur affectations (pattern Bug A — Zoro 2026-05-15)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// DELETE /api/affectations/[id]
// ============================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'DELETE /api/affectations/[id]',
  })

  try {
    const { id: affectationId } = await params

    // 1. Claims (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Conducteur ou admin uniquement pour supprimer une affectation
    if (role !== 'conducteur' && role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const supabase = await createClient()

    // 3. assertTrialActive — D-012
    await assertTrialActive(supabase, organisationId)

    const adminClient = createAdminClient()

    // 4. Vérifier ownership via organisation_id — T-02
    // On récupère user_id + chantier_id : nécessaires pour la désassignation
    // automatique des tâches (étapes 6-7).
    // Retourner 404 (I-06) plutôt que de laisser la delete silencieusement échouer.
    const { data: existingRaw, error: existingError } = await adminClient
      .from('affectations')
      .select('id, organisation_id, user_id, chantier_id')
      .eq('id', affectationId)
      .eq('organisation_id', organisationId)
      .single()

    const existing = existingRaw as
      | { id: string; organisation_id: string; user_id: string; chantier_id: string }
      | null

    if (existingError || !existing) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    // 5. DELETE physique — une affectation supprimée n'a pas de valeur historique
    // (contrairement à un chantier archivé — D-013 ne s'applique pas ici)
    const { error: deleteError } = await adminClient
      .from('affectations')
      .delete()
      .eq('id', affectationId)
      .eq('organisation_id', organisationId)

    if (deleteError) {
      reqLogger.error(
        { error: deleteError.message, affectationId },
        'Erreur suppression affectation',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    // 6. Désassignation automatique des tâches (Sprint 2 dette 2026-05-20).
    // Si le membre n'a plus d'autre affectation active sur ce chantier, ses tâches
    // doivent passer à `assigned_to=NULL` pour pouvoir être réassignées. Sinon
    // elles restent "assignées à un fantôme" — le membre n'apparaît plus dans la
    // liste équipe mais reste dans la colonne "Assigné" des tâches.
    //
    // Pas de UNIQUE (chantier_id, user_id) côté schéma : on compte explicitement
    // les affectations restantes pour ce user/chantier avant de désassigner.
    const { count: remainingCount, error: countError } = await adminClient
      .from('affectations')
      .select('id', { count: 'exact', head: true })
      .eq('chantier_id', existing.chantier_id)
      .eq('user_id', existing.user_id)
      .eq('organisation_id', organisationId)

    if (countError) {
      // Best-effort : on ne fail pas le DELETE déjà effectué — log l'erreur
      // pour cleanup manuel éventuel. L'admin peut retry le retrait sans effet.
      reqLogger.error(
        {
          error: countError.message,
          affectationId,
          memberUserId: existing.user_id,
          chantierId: existing.chantier_id,
          actorUserId: userId,
        },
        'Erreur count affectations restantes — désassignation tâches non tentée',
      )
      return new NextResponse(null, { status: 204 })
    }

    if ((remainingCount ?? 0) === 0) {
      // 7. Aucune autre affectation : désassigner les tâches du chantier
      const { error: updateError, count: tachesUpdatedCount } = await adminClient
        .from('taches')
        .update({ assigned_to: null }, { count: 'exact' })
        .eq('chantier_id', existing.chantier_id)
        .eq('assigned_to', existing.user_id)
        .eq('organisation_id', organisationId)

      if (updateError) {
        reqLogger.error(
          {
            error: updateError.message,
            affectationId,
            memberUserId: existing.user_id,
            chantierId: existing.chantier_id,
            actorUserId: userId,
          },
          'Erreur désassignation tâches — cleanup manuel requis',
        )
        // Ne pas faire échouer le DELETE : l'affectation EST supprimée.
        // L'admin peut re-tenter manuellement (PATCH tâche par tâche).
      } else {
        reqLogger.info(
          {
            affectationId,
            memberUserId: existing.user_id,
            chantierId: existing.chantier_id,
            actorUserId: userId,
            tachesUpdatedCount: tachesUpdatedCount ?? 0,
          },
          tachesUpdatedCount && tachesUpdatedCount > 0
            ? `Affectation supprimée + ${tachesUpdatedCount} tâche(s) désassignée(s)`
            : 'Affectation supprimée (aucune tâche à désassigner)',
        )
        return new NextResponse(null, { status: 204 })
      }
    }

    reqLogger.info(
      {
        affectationId,
        memberUserId: existing.user_id,
        chantierId: existing.chantier_id,
        actorUserId: userId,
        remainingAffectations: remainingCount ?? 0,
      },
      'Affectation supprimée (membre conserve d\'autres affectations sur ce chantier)',
    )

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
