// lib/ouvrier-session.ts
// SERVEUR UNIQUEMENT — Node runtime obligatoire (D-3-010)
// Helper centralise pour la session Redis ouvrier (D-3-002 BINDING)
//
// Ce fichier est LE SEUL endroit ou la session ouvrier est lue et validee.
// JAMAIS appeler redis.get('ouvrier_session:...') directement dans un handler.
// Toute deviation doit etre documentee dans DECISIONLOG.md.

import type { NextRequest } from 'next/server'
import { redis } from '@/lib/redis'
import { logger } from '@/lib/logger'
import { OuvrierSessionSchema } from '@/lib/validation/ouvrier'
import type { OuvrierSession } from '@/types/database'

// TTL session ouvrier : 7 jours en secondes (D-051/PO-005, RG-SESSION-001)
export const OUVRIER_SESSION_TTL = 604800

// Prefixe cle Redis session (D-3-003)
export const REDIS_SESSION_PREFIX = 'ouvrier_session:'

// Prefixe index inverse user → sessions (D-3-011)
export const REDIS_USER_SESSIONS_PREFIX = 'ouvrier_user_sessions:'

// ============================================================
// getOuvrierSession — 5 etapes obligatoires (D-3-002 BINDING)
// ============================================================
//
// 1. Lire cookie `ouvrier_session` (valeur = sessionId)
// 2. redis.get(cle) — si null → return null (session inexistante ou expiree)
// 3. redis.expire(cle, TTL) — sliding window (D-051/PO-005, RG-SESSION-001)
// 4. JSON.parse + OuvrierSessionSchema.safeParse() — si KO → return null + log warn
// 5. return l'objet OuvrierSession type
//
// K3-MED-11 : jamais logger le sessionId en clair

export async function getOuvrierSession(request: NextRequest): Promise<OuvrierSession | null> {
  // Etape 1 — Lire cookie
  const sessionId = request.cookies.get('ouvrier_session')?.value

  if (!sessionId) {
    return null
  }

  const key = REDIS_SESSION_PREFIX + sessionId

  let rawValue: string | null
  try {
    // Etape 2 — redis.get
    rawValue = await redis.get(key)
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'getOuvrierSession: Redis indisponible lors du get — retour null',
    )
    return null
  }

  if (rawValue === null) {
    // Session inexistante ou TTL expire — D-3-002 etape 2
    return null
  }

  // Etape 3 — sliding window : renouveler le TTL a chaque acces authentifie
  // D-051/PO-005, RG-SESSION-001 : chaque hit repart a 7j
  // Best-effort : si expire echoue, la session reste valide jusqu'au TTL actuel
  try {
    await redis.expire(key, OUVRIER_SESSION_TTL)
  } catch (err) {
    // Non-bloquant : la session est quand meme retournee (best-effort D-3-002 etape 3)
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'getOuvrierSession: Redis expire echoue (best-effort) — session retournee quand meme',
    )
  }

  // Etape 4 — JSON.parse + validation Zod
  let parsed: OuvrierSession
  try {
    const jsonParsed: unknown = JSON.parse(rawValue)
    const result = OuvrierSessionSchema.safeParse(jsonParsed)

    if (!result.success) {
      // Session corrompue ou schema obsolete — invalider silencieusement
      logger.warn(
        { issues: result.error.flatten() },
        'getOuvrierSession: schema Redis invalide — session abandonnee',
      )
      return null
    }

    parsed = result.data
  } catch {
    // JSON.parse echoue — donnee corrompue
    logger.warn(
      {},
      'getOuvrierSession: JSON.parse echoue sur valeur Redis — session abandonnee',
    )
    return null
  }

  // Etape 5 — retourner la session valide
  return parsed
}

// ============================================================
// invalidateOuvrierSessionsForUser — D-3-011
// ============================================================
//
// Appelee apres DELETE affectation pour mettre a jour ou supprimer la session Redis
// de l'ouvrier concerne.
//
// Comportement :
//   - SMEMBERS ouvrier_user_sessions:{userId} → liste des sessionIds actifs
//   - Pour chaque session :
//     - redis.get → parse session
//     - retirer l'affectation supprimee du tableau affectations
//     - si affectations vide apres retrait → DEL la session + SREM du SET
//     - si affectations non-vide → SETEX la session mise a jour (TTL conserve)
//
// Best-effort : si Redis down, log warn mais ne pas lever d'exception.
// Le RBAC base (D-3-005) a chaque hit ouvrier sauvegarde la securite.
//
// RG-SESSION-005 : a chaque DELETE affectation, l'ouvrier perd l'acces
// au chantier retire lors de sa prochaine requete.

export async function invalidateOuvrierSessionsForUser(
  userId: string,
  removedAffectationId: string,
): Promise<void> {
  const userSessionsKey = REDIS_USER_SESSIONS_PREFIX + userId

  let sessionIds: string[]
  try {
    sessionIds = await redis.smembers(userSessionsKey)
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), userId },
      'invalidateOuvrierSessionsForUser: SMEMBERS echoue — invalidation Redis abandonnee (best-effort)',
    )
    return
  }

  if (sessionIds.length === 0) {
    // Aucune session active pour cet utilisateur — rien a faire
    return
  }

  for (const sessionId of sessionIds) {
    const key = REDIS_SESSION_PREFIX + sessionId

    try {
      const rawValue = await redis.get(key)

      if (rawValue === null) {
        // Session deja expiree — nettoyer le SET
        await redis.srem(userSessionsKey, sessionId)
        continue
      }

      const jsonParsed: unknown = JSON.parse(rawValue)
      const result = OuvrierSessionSchema.safeParse(jsonParsed)

      if (!result.success) {
        // Session corrompue — supprimer
        await redis.del(key)
        await redis.srem(userSessionsKey, sessionId)
        continue
      }

      const session = result.data

      // Retirer l'affectation supprimee
      const updatedAffectations = session.affectations.filter(
        (a) => a.affectation_id !== removedAffectationId,
      )

      if (updatedAffectations.length === 0) {
        // Plus aucune affectation active → invalider completement la session
        await redis.del(key)
        await redis.srem(userSessionsKey, sessionId)
        logger.info(
          { userId, removedAffectationId },
          'Session Redis ouvrier supprimee (derniere affectation retiree)',
        )
      } else {
        // Mettre a jour la session avec les affectations restantes
        // TTL : conserver 604800 (sliding window — la session reste active)
        const updatedSession: OuvrierSession = {
          ...session,
          affectations: updatedAffectations,
        }
        await redis.setex(key, OUVRIER_SESSION_TTL, JSON.stringify(updatedSession))
        logger.info(
          { userId, removedAffectationId, remainingAffectations: updatedAffectations.length },
          'Session Redis ouvrier mise a jour (affectation retiree, session conservee)',
        )
      }
    } catch (err) {
      // Best-effort : si une session echoue, continuer avec les autres
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), userId },
        'invalidateOuvrierSessionsForUser: erreur sur une session — continue (best-effort)',
      )
    }
  }
}
