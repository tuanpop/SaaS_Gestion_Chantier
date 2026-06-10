// lib/reporting/destinataires.ts — Résolution des destinataires internes
// TST-K5-13 : filtre deleted_at IS NULL — soft-deleted exclus
// SURF-5-09 Kakashi : org_id = celui du CR (pas du JWT seul)
// PO-5-04 BINDING : jamais d'email externe, jamais de contact_email chantier
// AM-03 : inclure l'expéditeur dans les destinataires (SELECT sans exclusion auteur)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logger } from '@/lib/logger'

type AdminClient = Pick<SupabaseClient<Database>, 'from'>

/**
 * Résout les emails des destinataires internes d'une organisation.
 *
 * Règle RG-CR-011 :
 *   SELECT email FROM users
 *   WHERE organisation_id = orgId
 *     AND role IN ('admin', 'conducteur')
 *     AND deleted_at IS NULL
 *
 * L'org_id doit être celui du CR/rapport, pas seulement du JWT appelant (SURF-5-09).
 * AM-03 : l'expéditeur est inclus dans les destinataires (pas d'exclusion de l'auteur).
 *
 * @returns Liste d'emails. Si vide → cas anormal (org sans admin), loggué.
 */
export async function resolveDestinatairesInternes(
  orgId: string,
  adminClient: AdminClient,
): Promise<string[]> {
  const { data, error } = await (adminClient as SupabaseClient<Database>)
    .from('users')
    .select('email')
    .eq('organisation_id', orgId)
    .in('role', ['admin', 'conducteur'])
    .is('deleted_at', null)

  if (error) {
    logger.error(
      { orgId, error: error.message },
      'resolveDestinatairesInternes: erreur DB',
    )
    return []
  }

  const emails = (data ?? [])
    .map((u) => (u as unknown as { email: string | null }).email)
    .filter((e): e is string => typeof e === 'string' && e.length > 0)

  if (emails.length === 0) {
    logger.warn(
      { orgId },
      'resolveDestinatairesInternes: aucun destinataire interne trouvé — cas anormal',
    )
  }

  return emails
}
