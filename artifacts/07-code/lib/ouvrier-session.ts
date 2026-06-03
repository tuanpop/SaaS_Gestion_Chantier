// lib/ouvrier-session.ts
// SERVEUR UNIQUEMENT — Node runtime obligatoire (D-3-010)
// Helper centralise pour la session ouvrier (D-3-002 BINDING)
//
// Ce fichier est LE SEUL endroit ou la session ouvrier est lue et validee.
// JAMAIS appeler session-store directement dans un Route Handler.
// Toute deviation doit etre documentee dans DECISIONLOG.md.
//
// D-054 : implementation passee de Redis a Postgres (lib/session-store.ts).
// API publique inchangee — les callers (handlers /api/ouvrier/*) ne voient pas le changement.

import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionStore } from '@/lib/session-store'
import { logger } from '@/lib/logger'
import { OuvrierSessionSchema } from '@/lib/validation/ouvrier'
import type { OuvrierSession } from '@/types/database'

// TTL session ouvrier : 7 jours en secondes (D-051/PO-005, RG-SESSION-001)
export const OUVRIER_SESSION_TTL = 604800

// Prefixes conserves pour compatibilite des tests existants.
// Fonctionnellement inutilises en V1 Postgres (pas de cle Redis construite ici).
// Renommes : suppression du prefixe REDIS_ (D-054 — Redis retire).
export const SESSION_PREFIX = 'ouvrier_session:'
export const USER_SESSIONS_PREFIX = 'ouvrier_user_sessions:'

// Aliases REDIS_* pour compatibilite backward des imports existants (tests, handlers).
// Deprecated : a supprimer en V2 quand tous les consommateurs auront ete mis a jour.
export const REDIS_SESSION_PREFIX = SESSION_PREFIX
export const REDIS_USER_SESSIONS_PREFIX = USER_SESSIONS_PREFIX

// ============================================================
// getOuvrierSession — 5 etapes obligatoires (D-3-002 BINDING)
// ============================================================
//
// 1. Lire cookie `ouvrier_session` (valeur = sessionId)
// 2. sessionStore.read(sessionId) — si null → return null (session inexistante ou expiree)
// 3. sessionStore.touch(sessionId, TTL) — sliding window (D-051/PO-005, RG-SESSION-001)
// 4. Validation Zod OuvrierSessionSchema — si KO → return null + log warn
// 5. return l'objet OuvrierSession type
//
// K3-MED-11 : jamais logger le sessionId en clair

export async function getOuvrierSession(request: NextRequest): Promise<OuvrierSession | null> {
  // Etape 1 — Lire cookie
  const sessionId = request.cookies.get('ouvrier_session')?.value

  if (!sessionId) {
    return null
  }

  const adminClient = createAdminClient()
  const sessionStore = getSessionStore(adminClient)

  let rawSession: OuvrierSession | null
  try {
    // Etape 2 — Lire la session Postgres (cleanup lazy expire integre dans la query)
    rawSession = await sessionStore.read(sessionId)
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'getOuvrierSession: Postgres indisponible lors du read — retour null',
    )
    return null
  }

  if (rawSession === null) {
    // Session inexistante ou TTL expire — D-3-002 etape 2
    return null
  }

  // Etape 3 — sliding window : renouveler le TTL a chaque acces authentifie
  // D-051/PO-005, RG-SESSION-001 : chaque hit repart a 7j
  // Best-effort : si touch echoue, la session reste valide jusqu'au TTL actuel
  try {
    await sessionStore.touch(sessionId, OUVRIER_SESSION_TTL)
  } catch (err) {
    // Non-bloquant : la session est quand meme retournee (best-effort D-3-002 etape 3)
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'getOuvrierSession: touch Postgres echoue (best-effort) — session retournee quand meme',
    )
  }

  // Etape 4 — Validation Zod (defense en profondeur — schema peut evoluer)
  const result = OuvrierSessionSchema.safeParse(rawSession)

  if (!result.success) {
    // Session corrompue ou schema obsolete — invalider silencieusement
    logger.warn(
      { issues: result.error.flatten() },
      'getOuvrierSession: schema Postgres invalide — session abandonnee',
    )
    return null
  }

  // Etape 5 — retourner la session valide
  return result.data
}

// ============================================================
// invalidateOuvrierSessionsForUser — D-3-011
// ============================================================
//
// Appelee apres DELETE affectation pour invalider la session Postgres
// de l'ouvrier concerne.
//
// V1 Postgres (D-054) : DELETE simplifie par rapport a la version Redis.
// L'index inverse user→sessions (Redis SADD) est remplace par une colonne
// user_id indexee dans ouvrier_sessions (idx_ouvrier_sessions_user).
// Un seul DELETE WHERE user_id invalide toutes les sessions de l'ouvrier.
//
// Note comportement V1 vs Redis :
//   - Redis V0 : retirait l'affectation supprimee de la session, conservait la
//     session si d'autres affectations restaient.
//   - Postgres V1 (D-054) : supprime TOUTES les sessions de l'ouvrier. Plus simple,
//     force un rescan QR sur le prochain acces. Acceptable V1 (volume negligeable).
//     Si le comportement fin Redis est necessaire V2 : recreer la session mise a jour
//     via create() + delete() dans cette fonction.
//
// Best-effort : si Postgres down, log warn mais ne pas lever d'exception.
// Le RBAC base (D-3-005) a chaque hit ouvrier sauvegarde la securite.
//
// RG-SESSION-005 : a chaque DELETE affectation, l'ouvrier perd l'acces
// au chantier retire lors de sa prochaine requete.

export async function invalidateOuvrierSessionsForUser(
  userId: string,
  _removedAffectationId: string,
): Promise<{ invalidated: number }> {
  const adminClient = createAdminClient()
  const sessionStore = getSessionStore(adminClient)

  try {
    const count = await sessionStore.invalidateForUser(userId)
    if (count > 0) {
      logger.info(
        { userId, invalidated: count },
        'Sessions Postgres ouvrier invalidees (DELETE affectation D-3-011)',
      )
    }
    return { invalidated: count }
  } catch (err) {
    // Best-effort : ne pas faire echouer le DELETE affectation qui a deja reussi
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), userId },
      'invalidateOuvrierSessionsForUser: erreur Postgres — invalidation abandonnee (best-effort)',
    )
    return { invalidated: 0 }
  }
}
