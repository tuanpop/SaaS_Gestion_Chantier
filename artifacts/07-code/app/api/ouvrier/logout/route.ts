// app/api/ouvrier/logout/route.ts
// POST /api/ouvrier/logout — Logout explicite ouvrier (S4-F03, D-4-008)
//
// Implemente : US-4.9 (logout ouvrier), RG-LOGOUT-001 a 004
// Items securite :
//   D-4-008 : semantique logout — suppression explicite (≠ cascade D-055)
//   K4-MED-08 : CSRF — SameSite=Lax suffit (cookie propre, meme origine)
//   K4-MED-09 : sessionId depuis cookie UNIQUEMENT — jamais du body ni du query
//   K4-LOW-08 : attributs cookie identiques a la creation (HttpOnly, Secure, SameSite=Lax, Path=/)
//   D-4-015 : runtime = 'nodejs' obligatoire (service Postgres non compatible Edge)
//
// Comportement :
//   1. Lire cookie `ouvrier_session` (valeur = sessionId)
//   2. Si present : sessionStore.delete(sessionId) best-effort (warn si KO, continuer)
//   3. Reponse 200 { ok: true } + Set-Cookie ouvrier_session=; ... Max-Age=0
//   4. Idempotent : 200 meme sans cookie (RG-LOGOUT-003)
//
// UI : window.location.href = '/ouvrier/scan' apres 200 (hard redirect RG-LOGOUT-004)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionStore } from '@/lib/session-store'
import { logger } from '@/lib/logger'

// Attributs cookie identiques a la creation (D-4-008, K4-LOW-08)
// La suppression cookie requiert EXACTEMENT les memes attributs que lors de la creation
// (K3-MED-11 : sessionId jamais logge en clair)
const COOKIE_NAME = 'ouvrier_session'

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'POST /api/ouvrier/logout' })

  try {
    // Etape 1 — Lire cookie ouvrier_session (K4-MED-09 : source exclusive = cookie)
    // JAMAIS lire user_id ou session_id depuis le body — uniquement le cookie
    const sessionId = request.cookies.get(COOKIE_NAME)?.value

    if (!sessionId) {
      // Idempotent : 200 meme sans cookie (RG-LOGOUT-003)
      reqLogger.debug('Logout sans cookie — idempotent 200')
      return buildLogoutResponse()
    }

    // Etape 2 — sessionStore.delete best-effort (D-4-008, RG-LOGOUT-001)
    // K3-MED-11 : sessionId jamais logge en clair — on logue seulement l'evenement
    try {
      const adminClient = createAdminClient()
      const sessionStore = getSessionStore(adminClient)
      await sessionStore.delete(sessionId)
      reqLogger.info('Session ouvrier supprimee (logout explicite D-4-008)')
    } catch (err) {
      // Best-effort : si Postgres down, effacer le cookie quand meme (RG-LOGOUT-001)
      reqLogger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Logout : sessionStore.delete KO (best-effort) — cookie efface quand meme',
      )
    }

    // Etape 3 — Reponse 200 + cookie Max-Age=0 (D-4-008, K4-LOW-08)
    return buildLogoutResponse()
  } catch (error) {
    // Meme en cas d'erreur non geree, retourner 200 + effacer le cookie
    // Le bouton de deconnexion ne doit jamais bloquer l'ouvrier (RG-LOGOUT-003)
    reqLogger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'Logout : erreur non geree — 200 quand meme + cookie efface',
    )
    return buildLogoutResponse()
  }
}

/**
 * Construit la reponse 200 avec le header Set-Cookie qui efface le cookie ouvrier_session.
 * Attributs identiques a la creation (K4-LOW-08 BINDING).
 */
function buildLogoutResponse(): NextResponse {
  const response = NextResponse.json({ ok: true }, { status: 200 })
  // Set-Cookie avec Max-Age=0 efface le cookie cote navigateur
  // Les attributs HttpOnly, Secure, SameSite=Lax, Path=/ doivent etre IDENTIQUES
  // a ceux utilises lors de la creation (K4-LOW-08)
  response.headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  )
  return response
}
