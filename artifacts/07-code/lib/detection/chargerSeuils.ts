// lib/detection/chargerSeuils.ts — Chargement des seuils effectifs par organisation
// D-6-08 : le cron ne lit JAMAIS les constantes SEUILS_DEFAUT directement.
//           Il passe TOUJOURS par chargerSeuils() qui gère le fallback.
// PO-6-02=B : seuils configurables par org (table seuils_derives), fallback défaut si absent.
//
// Sécurité : adminClient + filtre organisation_id handler-level (D-6-09 BINDING).
// Déviation #1 (dette typée) : les nouvelles tables (seuils_derives) ne sont pas dans
//   Database (supabase gen types pas encore régénéré post-mig-015).
//   Cast 'as unknown as' utilisé. TODO: remove cast after supabase gen types post-mig-015.

import type { SeuilsEffectifs } from '@/types/detection'
import { SEUILS_DEFAUT } from '@/types/detection'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

// ============================================================
// chargerSeuils — retourne SeuilsEffectifs pour une organisation
// source='db' si ligne trouvée dans seuils_derives
// source='defaut' si aucune ligne (fallback SEUILS_DEFAUT)
// ============================================================

/**
 * Charge les seuils de détection pour une organisation.
 * Si aucune ligne n'existe dans seuils_derives, retourne SEUILS_DEFAUT avec source='defaut'.
 *
 * Jamais throw : en cas d'erreur DB, log warn + retour défauts (résilience du cron).
 *
 * @param orgId - organisation_id de l'org à charger
 * @param adminClient - client Supabase service_role (bypass RLS — D-6-09)
 */
export async function chargerSeuils(
  orgId: string,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<SeuilsEffectifs> {
  try {
    // TODO: remove cast after supabase gen types post-mig-015 (déviation #1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as unknown as any)
      .from('seuils_derives')
      .select('ratio_budget, jours_blocage, jours_inactivite')
      .eq('organisation_id', orgId)
      .maybeSingle() as {
        data: {
          ratio_budget: number
          jours_blocage: number
          jours_inactivite: number
        } | null
        error: { message: string } | null
      }

    if (error) {
      logger.warn(
        { orgId, error: error.message },
        'chargerSeuils: erreur DB — fallback défauts',
      )
      return buildDefauts(orgId)
    }

    if (!data) {
      logger.debug(
        { orgId },
        'chargerSeuils: aucune ligne seuils_derives — fallback défauts',
      )
      return buildDefauts(orgId)
    }

    logger.debug(
      {
        orgId,
        ratio_budget: data.ratio_budget,
        jours_blocage: data.jours_blocage,
        jours_inactivite: data.jours_inactivite,
        source: 'db',
      },
      'chargerSeuils: seuils chargés depuis DB',
    )

    return {
      organisation_id: orgId,
      ratio_budget: data.ratio_budget,
      jours_blocage: data.jours_blocage,
      jours_inactivite: data.jours_inactivite,
      source: 'db',
    }
  } catch (err) {
    logger.warn(
      { orgId, err: err instanceof Error ? err.message : String(err) },
      'chargerSeuils: exception inattendue — fallback défauts',
    )
    return buildDefauts(orgId)
  }
}

// ============================================================
// Helper interne
// ============================================================

function buildDefauts(orgId: string): SeuilsEffectifs {
  return {
    organisation_id: orgId,
    ...SEUILS_DEFAUT,
    source: 'defaut',
  }
}
