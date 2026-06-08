// lib/notifications/notif.ts
// Helper interne — création de notifications. Jamais exposé comme endpoint public.
// Appelé depuis : POST /api/chantiers/[id]/taches (remplace stub TODO existant)
//                 PATCH /api/taches/[id] (statut terminé/bloqué + ré-assignation)
//                 PATCH /api/chantiers/[id] (dérive budget)
//                 PATCH /api/ouvrier/taches/[id] (statut terminé/bloqué ouvrier)
//
// Sécurité :
//   K4V-02 : htmlEscape sur titre+message COMPLETS avant slice
//   K4V-06 : resolveConducteurChantier filtre org+deleted_at IS NULL+rôle
//   K4V-07 : log warn structuré sans contenu user brut (D-019 redact)
//   K4V-09 : InsertNotificationParams JAMAIS note_privee_conducteur ni storage_path
//   D-4V-002 : best-effort absolu — JAMAIS de throw

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { NotificationType } from '@/types/database'

// ============================================================
// Types — InsertNotificationParams (K4V-09 : sans note_privee_conducteur ni storage_path)
// ============================================================

export interface InsertNotificationParams {
  organisationId: string
  userId: string          // destinataire
  type: NotificationType
  titre: string           // max 200 chars — tronqué si nécessaire
  message: string         // max 1000 chars — tronqué si nécessaire
  chantierId?: string | null
  tacheId?: string | null
  // SECURITE : note_privee_conducteur JAMAIS ici (K4V-09, D-051/PO-014, RG-NOTIF-014)
  // SECURITE : storage_path JAMAIS ici (RG-NOTIF-015)
}

// ============================================================
// htmlEscape — utilitaire pure (D-4V-003, K4V-02)
// Ordre impératif : '&' EN PREMIER pour éviter la double-substitution.
// Symétrique avec public.sql_html_escape() côté cron SQL (RG-NOTIF-005).
// ============================================================

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')    // EN PREMIER — évite double-encodage
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ============================================================
// resolveConducteurChantier — PO-3-AM-01
// Premier conducteur affecté au chantier par created_at ASC, deleted_at IS NULL
// Filtre org pour garantir l'isolation multi-tenant (K4V-06)
// ============================================================

export async function resolveConducteurChantier(
  adminClient: ReturnType<typeof createAdminClient>,
  chantierId: string,
  orgId: string,
): Promise<string | null> {
  try {
    const { data, error } = await adminClient
      .from('affectations')
      .select('user_id, users!affectations_user_id_fkey(role, deleted_at)')
      .eq('chantier_id', chantierId)
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: true })

    if (error || !data || data.length === 0) {
      return null
    }

    // Trouver le premier conducteur non supprimé
    for (const aff of data) {
      const affTyped = aff as unknown as {
        user_id: string
        users: { role: string; deleted_at: string | null } | null
      }
      if (
        affTyped.users &&
        affTyped.users.role === 'conducteur' &&
        affTyped.users.deleted_at === null
      ) {
        return affTyped.user_id
      }
    }

    return null
  } catch (err) {
    logger.warn(
      { chantierId, orgId, err: err instanceof Error ? err.message : String(err) },
      'resolveConducteurChantier erreur',
    )
    return null
  }
}

// ============================================================
// resolveAdminsOrg — tous les admins de l'organisation non supprimés
// Filtre org pour garantir l'isolation multi-tenant (K4V-06)
// ============================================================

export async function resolveAdminsOrg(
  adminClient: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<string[]> {
  try {
    const { data, error } = await adminClient
      .from('users')
      .select('id')
      .eq('organisation_id', orgId)
      .eq('role', 'admin')
      .is('deleted_at', null)

    if (error || !data) {
      return []
    }

    return data.map((u) => (u as unknown as { id: string }).id)
  } catch (err) {
    logger.warn(
      { orgId, err: err instanceof Error ? err.message : String(err) },
      'resolveAdminsOrg erreur',
    )
    return []
  }
}

// ============================================================
// insertNotification — best-effort absolu (D-4V-002, LE POINT DUR)
//
// Séquence stricte :
//   1. userId falsy → warn + return (jamais d'INSERT user_id=null — K4V-06)
//   2. htmlEscape titre+message COMPLETS puis slice(0,200)/slice(0,1000) (K4V-02, RG-NOTIF-004)
//   3. Idempotence : SELECT lookup IS NOT DISTINCT FROM via branches conditionnelles (P-01, RG-NOTIF-016)
//   4. Si notif non lue existe déjà → return
//   5. INSERT via adminClient (service_role)
//   6. Toute erreur → logger.warn structuré + return — JAMAIS de throw (D-4V-002)
//      Le log NE contient PAS titre/message bruts (K4V-12, D-019 redact)
// ============================================================

export async function insertNotification(
  params: InsertNotificationParams,
): Promise<void> {
  const { organisationId, userId, type, chantierId, tacheId } = params

  // Étape 1 — userId falsy : jamais d'INSERT user_id=null (K4V-06, edge §9)
  if (!userId) {
    logger.warn(
      { type, organisationId },
      'insertNotification : userId falsy — notification ignorée (conducteur introuvable ?)',
    )
    return
  }

  // Étape 2 — htmlEscape sur titre+message COMPLETS, puis troncature (K4V-02, RG-NOTIF-004/005)
  const titre = htmlEscape(params.titre).slice(0, 200)
  const message = htmlEscape(params.message).slice(0, 1000)

  const adminClient = createAdminClient()

  try {
    // Étape 3 — Idempotence : SELECT 1 WHERE (user_id, type, chantier_id, tache_id, lu=false)
    // Branche conditionnelle pour IS NOT DISTINCT FROM (P-01 : Supabase JS n'a pas cet opérateur)
    // PO décision AMB-01 : branches if/else, pas de RPC
    // Pattern Bug A Zoro : adminClient résout 'notifications' comme never — cast as unknown requis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notifTable = (adminClient as unknown as any).from('notifications')
    let query = notifTable
      .select('id')
      .eq('user_id', userId)
      .eq('type', type)
      .eq('lu', false)
      .limit(1)

    // IS NOT DISTINCT FROM chantier_id
    if (chantierId != null) {
      query = query.eq('chantier_id', chantierId)
    } else {
      query = query.is('chantier_id', null)
    }

    // IS NOT DISTINCT FROM tache_id
    if (tacheId != null) {
      query = query.eq('tache_id', tacheId)
    } else {
      query = query.is('tache_id', null)
    }

    const { data: existing, error: selectError } = await query as { data: Array<{ id: string }> | null; error: { message: string } | null }

    if (selectError) {
      logger.warn(
        { type, userId, err: selectError.message },
        'insertNotification best-effort failed (SELECT idempotence)',
      )
      return
    }

    // Étape 4 — si notif non lue identique existe → skip
    if (existing && existing.length > 0) {
      return
    }

    // Étape 5 — INSERT via adminClient (service_role, bypass RLS)
    // Pattern Bug A Zoro : cast as unknown pour les nouvelles tables (notifications non dans Database)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (adminClient as unknown as any)
      .from('notifications')
      .insert({
        organisation_id: organisationId,
        user_id: userId,
        type,
        titre,
        message,
        chantier_id: chantierId ?? null,
        tache_id: tacheId ?? null,
        lu: false,
        read_at: null,
      }) as { error: { message: string } | null }

    if (insertError) {
      // Étape 6 — best-effort : log warn sans contenu brut (K4V-12), jamais throw
      logger.warn(
        { type, userId, err: insertError.message },
        'insertNotification best-effort failed (INSERT)',
      )
      return
    }
  } catch (err) {
    // Étape 6 — erreur inattendue : log warn structuré, jamais throw (D-4V-002)
    logger.warn(
      { type, userId, err: err instanceof Error ? err.message : String(err) },
      'insertNotification best-effort failed (exception)',
    )
  }
}
