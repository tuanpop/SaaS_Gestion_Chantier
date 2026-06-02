// app/api/auth/qr/[token]/route.ts
// GET /api/auth/qr/[token] — Scan QR ouvrier : dechiffrement AES, creation session Redis, cookie, redirect
//
// Implemente : US-3.1 (scan QR), US-3.2 (session Redis TTL 7j), US-3.5 (multi-affectations),
//              US-3.11 (no-affectation → telephone conducteur), RG-SCAN-001 a 006
// Items securite : K3-I-02 (no token en log), K3-E-01 (role lu en base), K3-CR-01 (QR vol),
//                  D-3-009, D-3-010 (nodejs runtime), D-3-003 (session schema),
//                  D-3-021 (cookie Path=/), D-3-011 (index inverse)
//
// ROUTE PUBLIQUE — pas de JWT Supabase requis (le token QR EST le credential)
// Doit etre dans PUBLIC_PREFIXES middleware : /api/auth/qr/

// D-3-010 : Node runtime obligatoire (ioredis incompatible Edge)
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptQR, InvalidQRTokenError } from '@/lib/crypto'
import { redis } from '@/lib/redis'
import { logger } from '@/lib/logger'
import { OUVRIER_SESSION_TTL, REDIS_SESSION_PREFIX, REDIS_USER_SESSIONS_PREFIX } from '@/lib/ouvrier-session'
import type { OuvrierSession } from '@/types/database'

// ============================================================
// GET /api/auth/qr/[token]
// ============================================================

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // Cache-Control obligatoire — jamais cacher une reponse d'auth (K3-I-04)
  const responseHeaders = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

  const { token } = await params

  // 1. Dechiffrer le token AES-256-GCM (K3-I-02 : ne jamais logger le token en clair)
  let payload: { user_id: string; organisation_id: string }
  try {
    payload = decryptQR(token)
  } catch (err) {
    if (err instanceof InvalidQRTokenError) {
      // K3-I-02 : log sans le token en clair
      logger.warn(
        { reason: 'invalid_token' },
        'QR scan : token invalide ou falsifie',
      )
    } else {
      logger.error(
        { err: err instanceof Error ? err.message : 'unknown' },
        'QR scan : erreur inattendue au dechiffrement',
      )
    }
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=invalid_token', _request.url),
      { headers: responseHeaders },
    )
  }

  const { user_id, organisation_id } = payload

  const adminClient = createAdminClient()

  // 2. Verifier que l'utilisateur existe, est actif, et a le role ouvrier
  // K3-E-01 : le role est lu en base, jamais depuis le token
  const { data: userRow, error: userError } = await adminClient
    .from('users')
    .select('id, role, organisation_id, deleted_at')
    .eq('id', user_id)
    .is('deleted_at', null)
    .single()

  if (userError || !userRow) {
    logger.warn(
      { userId: user_id },
      'QR scan : utilisateur non trouve ou supprime',
    )
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=user_not_found', _request.url),
      { headers: responseHeaders },
    )
  }

  // K3-E-01 : le role doit etre ouvrier (lu en base, pas dans le token)
  if (userRow.role !== 'ouvrier') {
    logger.warn(
      { userId: user_id, role: userRow.role },
      'QR scan : utilisateur non ouvrier',
    )
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=user_not_found', _request.url),
      { headers: responseHeaders },
    )
  }

  // 3. Defense cross-org : organisation_id du token == organisation_id du user en base
  if (userRow.organisation_id !== organisation_id) {
    logger.warn(
      { userId: user_id },
      'QR scan : incoherence organisation_id token vs base (K3-CR-01)',
    )
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=user_not_found', _request.url),
      { headers: responseHeaders },
    )
  }

  // 4. Recuperer les affectations actives de l'ouvrier (RG-SCAN-004)
  // Criteres : deleted_at IS NULL + chantier actif + date_fin non depassee
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  const { data: affectationsRaw, error: affError } = await adminClient
    .from('affectations')
    .select('id, chantier_id, vue, chantiers!affectations_chantier_id_fkey(statut)')
    .eq('user_id', user_id)
    .eq('organisation_id', organisation_id)
    .is('deleted_at', null)
    .or(`date_fin.is.null,date_fin.gte.${today}`)

  if (affError) {
    logger.error(
      { err: affError.message, userId: user_id },
      'QR scan : erreur requete affectations',
    )
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=server_error', _request.url),
      { headers: responseHeaders },
    )
  }

  // Filtrer sur les chantiers actifs uniquement (RG-SCAN-004)
  type AffectationRaw = {
    id: string
    chantier_id: string
    vue: 'mes_taches' | 'chantier_complet'
    chantiers: { statut: string } | null
  }
  const affectations = ((affectationsRaw ?? []) as AffectationRaw[]).filter(
    (a) => a.chantiers?.statut === 'actif',
  )

  // 5. Dispatcher selon le nombre d'affectations actives
  if (affectations.length === 0) {
    // Cas 0 affectation — RG-NO-AFFECTATION-002
    // Ne pas creer de session Redis. Recuperer le conducteur pour affichage.
    return handleNoAffectation(_request, adminClient, user_id, organisation_id, responseHeaders)
  }

  // 6. Creer la session Redis pour les cas 1 ou ≥2 affectations
  const sessionId = crypto.randomUUID()
  const sessionKey = REDIS_SESSION_PREFIX + sessionId

  const sessionData: OuvrierSession = {
    user_id,
    organisation_id,
    role: 'ouvrier',
    affectations: affectations.map((a) => ({
      affectation_id: a.id,
      chantier_id: a.chantier_id,
      vue: a.vue as 'mes_taches' | 'chantier_complet',
    })),
    created_at: Date.now(),
  }

  try {
    // SETEX : session avec TTL 7j (D-051/PO-005)
    await redis.setex(sessionKey, OUVRIER_SESSION_TTL, JSON.stringify(sessionData))

    // Index inverse user → sessions (D-3-011) : permet l'invalidation ciblee
    const userSessionsKey = REDIS_USER_SESSIONS_PREFIX + user_id
    await redis.sadd(userSessionsKey, sessionId)
    await redis.expire(userSessionsKey, OUVRIER_SESSION_TTL)
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), userId: user_id },
      'QR scan : erreur creation session Redis',
    )
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=server_error', _request.url),
      { headers: responseHeaders },
    )
  }

  // 7. Construire le redirect selon le nombre d'affectations
  let redirectPath: string
  if (affectations.length === 1 && affectations[0] !== undefined) {
    // 1 affectation → aller directement au chantier (RG-MULTI-002)
    redirectPath = `/ouvrier/chantiers/${affectations[0].chantier_id}`
  } else {
    // ≥2 affectations → selecteur de chantiers (RG-MULTI-001)
    redirectPath = '/ouvrier/chantiers'
  }

  // 8. Poser le cookie HttpOnly ouvrier_session
  // D-3-003, D-3-021 : Path=/ obligatoire (pas /ouvrier) pour que le cookie soit
  // transmis aux routes /api/ouvrier/* (diff path de /ouvrier/*)
  // SameSite=Lax : autorise les GET top-level cross-origin (scan QR iOS Safari)
  // Commentaire intentionnel K3-LOW-05 : ne PAS changer en Strict
  const redirectResponse = NextResponse.redirect(
    new URL(redirectPath, _request.url),
  )

  // Ajouter Cache-Control sur la reponse de redirect
  redirectResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')

  // SameSite=Lax est intentionnel (K3-LOW-05) :
  // iOS Safari scan QR natif = GET top-level cross-origin → Lax autorise ce cas
  // Strict bloquerait le scan QR → ne JAMAIS changer en Strict
  redirectResponse.cookies.set('ouvrier_session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',                    // D-3-021 : Path=/ pour /api/ouvrier/* et /ouvrier/*
    maxAge: OUVRIER_SESSION_TTL,
  })

  logger.info(
    {
      userId: user_id,
      affectationsCount: affectations.length,
      redirectPath,
    },
    'QR scan : session creee + redirect',
  )

  return redirectResponse
}

// ============================================================
// Cas 0 affectation — RG-NO-AFFECTATION-002
// ============================================================
// Recupere le dernier chantier + conducteur et construit un base64url
// pour la page /ouvrier/no-affectation

async function handleNoAffectation(
  request: NextRequest,
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  organisationId: string,
  responseHeaders: Record<string, string>,
): Promise<NextResponse> {
  // PO-3-AM-01 : requete conducteur via le dernier chantier de l'ouvrier (meme si sans affectation active)
  // Si created_by du chantier n'est pas conducteur → fallback premier conducteur de l'org (created_at ASC)
  const { data: lastAffectationData, error: lastAffError } = await adminClient
    .from('affectations')
    .select(`
      chantiers!affectations_chantier_id_fkey (
        nom,
        created_by,
        conducteur_user:users!chantiers_created_by_fkey (
          id, nom, prenom, telephone, role
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  let conducteurNom = 'Votre responsable'
  let conducteurPrenom = ''
  let conducteurTelephone: string | null = null
  let dernierChantierNom = 'Chantier'

  if (!lastAffError && lastAffectationData) {
    type LastAffData = {
      chantiers: {
        nom: string
        created_by: string
        conducteur_user: {
          id: string
          nom: string
          prenom: string
          telephone: string | null
          role: string
        } | null
      } | null
    }
    const typed = lastAffectationData as unknown as LastAffData
    const chantier = typed.chantiers

    if (chantier) {
      dernierChantierNom = chantier.nom

      if (chantier.conducteur_user && chantier.conducteur_user.role === 'conducteur') {
        // created_by est bien un conducteur
        conducteurNom = chantier.conducteur_user.nom
        conducteurPrenom = chantier.conducteur_user.prenom
        conducteurTelephone = chantier.conducteur_user.telephone
      } else {
        // PO-3-AM-01 fallback : chercher le premier conducteur de l'org par created_at ASC
        logger.warn(
          { userId, organisationId },
          'No-affectation : created_by du chantier n est pas conducteur — fallback premier conducteur org',
        )
        const { data: fallbackConducteur } = await adminClient
          .from('users')
          .select('nom, prenom, telephone')
          .eq('organisation_id', organisationId)
          .eq('role', 'conducteur')
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        if (fallbackConducteur) {
          conducteurNom = fallbackConducteur.nom
          conducteurPrenom = fallbackConducteur.prenom
          conducteurTelephone = fallbackConducteur.telephone
        }
      }
    }
  }

  // Construire le JSON base64 pour la page no-affectation (D-3-006)
  const dataObj = {
    conducteur_nom: conducteurNom,
    conducteur_prenom: conducteurPrenom,
    conducteur_telephone: conducteurTelephone,
    dernier_chantier_nom: dernierChantierNom,
  }
  const dataBase64 = Buffer.from(JSON.stringify(dataObj)).toString('base64url')

  logger.info(
    { userId, organisationId },
    'QR scan : aucune affectation active — redirect no-affectation',
  )

  const redirectResp = NextResponse.redirect(
    new URL(`/ouvrier/no-affectation?data=${dataBase64}`, request.url),
  )
  redirectResp.headers.set('Cache-Control', responseHeaders['Cache-Control'] ?? 'no-store')
  return redirectResp
}
