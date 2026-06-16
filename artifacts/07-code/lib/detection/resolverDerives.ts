// lib/detection/resolverDerives.ts — Résolution des dérives actives d'un chantier
// D-6-11 : appelé lors de l'archivage d'un chantier (best-effort, log warn, ne bloque jamais).
// RG-DERIVE-012 : pose resolved_at=NOW() sur toutes les derives_detectees actives du chantier.
//
// Best-effort absolu :
//   - catch interne : log warn, ne throw jamais
//   - l'appelant (handler PATCH/DELETE chantier) ne doit PAS conditionner le succès
//     de l'archivage au succès de la résolution
//
// Déviation #1 (dette typée) : cast as unknown as sur requête derives_detectees.
//   TODO: remove cast after supabase gen types post-mig-014.

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

// ============================================================
// resolverDerivesChantier — best-effort
// ============================================================

/**
 * Pose resolved_at=NOW() sur toutes les dérives actives (resolved_at IS NULL) d'un chantier.
 * Appelé lors de l'archivage d'un chantier (D-6-11).
 *
 * Best-effort absolu : catch interne, log warn, ne throw jamais.
 * L'archivage ne dépend PAS du succès de cette fonction.
 *
 * @param chantierId - ID du chantier archivé
 * @param adminClient - client Supabase service_role (bypass RLS — D-6-09)
 */
export async function resolverDerivesChantier(
  chantierId: string,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<void> {
  try {
    // UPDATE idempotent : WHERE resolved_at IS NULL — ne touche pas les dérives déjà résolues
    // TODO: remove cast after supabase gen types post-mig-014 (déviation #1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (adminClient as unknown as any)
      .from('derives_detectees')
      .update({ resolved_at: new Date().toISOString() })
      .eq('chantier_id', chantierId)
      .is('resolved_at', null) as { error: { message: string } | null; count: number | null }

    if (error) {
      logger.warn(
        { chantierId, error: error.message },
        'resolverDerivesChantier: erreur DB — archivage non bloqué (best-effort)',
      )
      return
    }

    logger.info(
      { chantierId, derives_resolues: count ?? 'unknown' },
      'resolverDerivesChantier: dérives actives résolues à l archivage',
    )
  } catch (err) {
    // Best-effort : ne jamais throw le cron ou le handler (D-6-11, TST-K6-24)
    logger.warn(
      { chantierId, err: err instanceof Error ? err.message : String(err) },
      'resolverDerivesChantier: exception inattendue — archivage non bloqué (best-effort)',
    )
  }
}
