// lib/reporting/destinataires.ts — Résolution des destinataires internes
// TST-K5-13 : filtre deleted_at IS NULL — soft-deleted exclus
// SURF-5-09 Kakashi : org_id = celui du CR (pas du JWT seul)
// PO-5-04 BINDING : jamais d'email externe, jamais de contact_email chantier
// AM-03 : inclure l'expéditeur dans les destinataires (SELECT sans exclusion auteur)
//
// RG-CR-011 REMPLACÉ (2026-06-15) par décision PO smoke :
//   Ancienne règle : tous les admins + conducteurs de l'org
//   Nouvelle règle : admins org ∪ conducteurs RATTACHÉS au chantier
//   Conducteur "rattaché" = created_by du chantier (s'il est conducteur, non supprimé)
//                           OU affectation ACTIVE au chantier (non supprimé)
//
// Divergence assumée (documentée par PO) :
//   canAccessChantier (lib/chantier-access.ts) accepte les affectations actives OU passées
//   — ici on exige actives uniquement : date_debut <= today AND (date_fin IS NULL OR date_fin >= today)
//   Raison : les destinataires doivent être des parties prenantes COURANTES du chantier.
//
// AM-03 propriété vérifiée : un conducteur qui envoie passe canAccessChantier (created_by ou
//   affecté actif/passé). Si created_by → inclus branche 1. Si affecté actif → inclus branche 2.
//   Si affecté passé uniquement → canAccessChantier=true mais ne reçoit pas (décision PO date
//   active). Pas d'exclusion ni d'inclusion artificielle nécessaire.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logger } from '@/lib/logger'

type AdminClient = Pick<SupabaseClient<Database>, 'from'>

/**
 * Résout les emails des destinataires internes pour l'envoi d'un CR ou rapport hebdo.
 *
 * Périmètre (décision PO 2026-06-15, remplace RG-CR-011) :
 *   - TOUS les admins de l'org (role='admin', deleted_at IS NULL)
 *   - + conducteurs rattachés au chantier :
 *       - le chantiers.created_by s'il est conducteur et deleted_at IS NULL
 *       - les conducteurs avec affectation ACTIVE sur ce chantier
 *         (date_debut <= today AND (date_fin IS NULL OR date_fin >= today), deleted_at IS NULL)
 *   - Dédoublonnage par email.
 *
 * L'org_id doit être celui du CR/rapport, pas seulement du JWT appelant (SURF-5-09).
 * AM-03 : l'expéditeur est inclus dans les destinataires (pas d'exclusion de l'auteur).
 *
 * @returns Liste d'emails dédoublonnés. Si vide → cas anormal (org sans admin), loggué.
 */
export async function resolveDestinatairesInternes(
  orgId: string,
  chantierId: string,
  adminClient: AdminClient,
): Promise<string[]> {
  // today au sens serveur — new Date() autorisé dans les handlers (décision PO)
  const today = new Date().toISOString().split('T')[0]! // "YYYY-MM-DD"

  const emailSet = new Set<string>()

  // ── Branche 1 : tous les admins de l'org ────────────────────────────────────
  const { data: adminsData, error: adminsError } = await (adminClient as SupabaseClient<Database>)
    .from('users')
    .select('email')
    .eq('organisation_id', orgId)
    .eq('role', 'admin')
    .is('deleted_at', null)

  if (adminsError) {
    logger.error(
      { orgId, chantierId, error: adminsError.message },
      'resolveDestinatairesInternes: erreur DB (admins)',
    )
    // On continue — les conducteurs peuvent encore être résolus
  } else {
    for (const u of adminsData ?? []) {
      const email = (u as unknown as { email: string | null }).email
      if (typeof email === 'string' && email.length > 0) {
        emailSet.add(email)
      }
    }
  }

  // ── Branche 2a : conducteur created_by du chantier ──────────────────────────
  const { data: chantierRow } = await (adminClient as SupabaseClient<Database>)
    .from('chantiers')
    .select('created_by')
    .eq('id', chantierId)
    .eq('organisation_id', orgId)
    .maybeSingle()

  const createdBy = (chantierRow as { created_by: string | null } | null)?.created_by ?? null

  if (createdBy) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: creatorData } = await (adminClient as unknown as any)
      .from('users')
      .select('email, role, deleted_at')
      .eq('id', createdBy)
      .eq('organisation_id', orgId)
      .maybeSingle()

    if (creatorData) {
      const creator = creatorData as unknown as {
        email: string | null
        role: string
        deleted_at: string | null
      }
      if (
        creator.role === 'conducteur' &&
        creator.deleted_at === null &&
        typeof creator.email === 'string' &&
        creator.email.length > 0
      ) {
        emailSet.add(creator.email)
      }
    }
  }

  // ── Branche 2b : conducteurs avec affectation ACTIVE sur le chantier ─────────
  // Affectation active = date_debut <= today AND (date_fin IS NULL OR date_fin >= today)
  // DIVERGENCE ASSUMÉE (PO 2026-06-15) : canAccessChantier inclut les affectations passées
  // — ici on filtre strictement actives pour ne cibler que les parties prenantes courantes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: affectationsData, error: affectationsError } = await (adminClient as unknown as any)
    .from('affectations')
    .select('user_id, date_fin')
    .eq('chantier_id', chantierId)
    .eq('organisation_id', orgId)
    .lte('date_debut', today)

  if (affectationsError) {
    logger.error(
      { orgId, chantierId, error: affectationsError.message },
      'resolveDestinatairesInternes: erreur DB (affectations)',
    )
  } else {
    // Filtrer date_fin côté app : IS NULL OR date_fin >= today
    // (Supabase JS .or() possible mais plus verbeux que ce filtre trivial en mémoire)
    const activeUserIds = (affectationsData as unknown as Array<{
      user_id: string
      date_fin: string | null
    }>)
      .filter((a) => a.date_fin === null || a.date_fin >= today)
      .map((a) => a.user_id)

    if (activeUserIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: conducteursData, error: conducteursError } = await (adminClient as unknown as any)
        .from('users')
        .select('email, role, deleted_at')
        .in('id', activeUserIds)
        .eq('organisation_id', orgId)

      if (conducteursError) {
        logger.error(
          { orgId, chantierId, error: conducteursError.message },
          'resolveDestinatairesInternes: erreur DB (conducteurs affectés)',
        )
      } else {
        for (const u of conducteursData ?? []) {
          const user = u as unknown as {
            email: string | null
            role: string
            deleted_at: string | null
          }
          if (
            user.role === 'conducteur' &&
            user.deleted_at === null &&
            typeof user.email === 'string' &&
            user.email.length > 0
          ) {
            emailSet.add(user.email)
          }
        }
      }
    }
  }

  const emails = Array.from(emailSet)

  if (emails.length === 0) {
    logger.warn(
      { orgId, chantierId },
      'resolveDestinatairesInternes: aucun destinataire interne trouvé — cas anormal',
    )
  }

  return emails
}
