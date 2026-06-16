// app/api/auth/qr/[token]/route.ts
// GET /api/auth/qr/[token] — Scan QR ouvrier : dechiffrement AES, creation session Postgres, cookie, redirect
//
// Implemente : US-3.1 (scan QR), US-3.2 (session TTL 7j), US-3.5 (multi-affectations),
//              US-3.11 (no-affectation → telephone conducteur), RG-SCAN-001 a 006
// Items securite : K3-I-02 (no token en log), K3-E-01 (role lu en base), K3-CR-01 (QR vol),
//                  D-3-009, D-3-010 (nodejs runtime), D-3-003 (session schema),
//                  D-3-021 (cookie Path=/), D-3-011 (invalidation user)
//
// ROUTE PUBLIQUE — pas de JWT Supabase requis (le token QR EST le credential)
// Doit etre dans PUBLIC_PREFIXES middleware : /api/auth/qr/
//
// D-054 : sessions passees de Redis a Postgres (table ouvrier_sessions).
// L'index inverse user→sessions (Redis SADD/SMEMBERS) est remplace par la colonne user_id
// indexee dans ouvrier_sessions (idx_ouvrier_sessions_user).

// D-3-010 : Node runtime obligatoire
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptQR, InvalidQRTokenError } from '@/lib/crypto'
import { getSessionStore } from '@/lib/session-store'
import { logger } from '@/lib/logger'
import { OUVRIER_SESSION_TTL } from '@/lib/ouvrier-session'
import { genererAccueilClaw } from '@/lib/chat/genererAccueilClaw'
import type { OuvrierSession } from '@/types/database'

// ============================================================
// GET /api/auth/qr/[token]
// ============================================================

/**
 * Construit la base URL publique en preservant le domaine reverse-proxy.
 * Next.js ne trust pas X-Forwarded-Host par defaut → _request.url retournerait
 * `http://0.0.0.0:3000/...` (interne Docker) au lieu du domaine public.
 * Priorite : x-forwarded-host (Traefik) → NEXT_PUBLIC_APP_URL → host header → _request.url
 */
function getPublicBaseUrl(request: NextRequest): string {
  const fwdHost = request.headers.get('x-forwarded-host')
  const fwdProto = request.headers.get('x-forwarded-proto') ?? 'https'
  if (fwdHost) return `${fwdProto}://${fwdHost}`
  const envUrl = process.env['NEXT_PUBLIC_APP_URL']
  if (envUrl) return envUrl
  const host = request.headers.get('host')
  if (host) return `${fwdProto}://${host}`
  return request.url
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // Cache-Control obligatoire — jamais cacher une reponse d'auth (K3-I-04)
  const responseHeaders = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

  // Base URL publique pour tous les redirects (fix bug 0.0.0.0:3000 reverse proxy)
  const baseUrl = getPublicBaseUrl(_request)

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
      new URL('/ouvrier/scan?error=invalid_token', baseUrl),
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
      new URL('/ouvrier/scan?error=user_not_found', baseUrl),
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
      new URL('/ouvrier/scan?error=user_not_found', baseUrl),
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
      new URL('/ouvrier/scan?error=user_not_found', baseUrl),
      { headers: responseHeaders },
    )
  }

  // 4. Recuperer les affectations actives de l'ouvrier (RG-SCAN-004)
  // Criteres : affectation presente (hard delete, pas de soft delete) + chantier actif + date_fin non depassee
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  const { data: affectationsRaw, error: affError } = await adminClient
    .from('affectations')
    .select('id, chantier_id, vue, chantiers!affectations_chantier_id_fkey(statut)')
    .eq('user_id', user_id)
    .eq('organisation_id', organisation_id)
    // FIX : affectations en hard delete (CASCADE migration 002), pas de deleted_at column
    .or(`date_fin.is.null,date_fin.gte.${today}`)

  if (affError) {
    logger.error(
      { err: affError.message, userId: user_id },
      'QR scan : erreur requete affectations',
    )
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=server_error', baseUrl),
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
    return handleNoAffectation(baseUrl, adminClient, user_id, organisation_id, responseHeaders)
  }

  // 6. Creer la session Postgres pour les cas 1 ou ≥2 affectations (D-054)
  const sessionId = crypto.randomUUID()

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
    // INSERT ouvrier_sessions avec TTL 7j (D-051/PO-005)
    // L'index inverse user→sessions est remplace par la colonne user_id indexee
    // dans ouvrier_sessions (idx_ouvrier_sessions_user) — D-054 simplification structurelle
    const sessionStore = getSessionStore(adminClient)
    await sessionStore.create(sessionId, sessionData, OUVRIER_SESSION_TTL)
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), userId: user_id },
      'QR scan : erreur creation session Postgres',
    )
    return NextResponse.redirect(
      new URL('/ouvrier/scan?error=server_error', baseUrl),
      { headers: responseHeaders },
    )
  }

  // 7. Construire le redirect selon le nombre d'affectations
  let redirectPath: string
  let accueilChantierId: string | null = null

  if (affectations.length === 1 && affectations[0] !== undefined) {
    // 1 affectation → aller directement au chantier (RG-MULTI-002)
    redirectPath = `/ouvrier/chantiers/${affectations[0].chantier_id}`
    accueilChantierId = affectations[0].chantier_id
  } else {
    // ≥2 affectations → selecteur de chantiers (RG-MULTI-001)
    redirectPath = '/ouvrier/chantiers'
    // Accueil Claw avec le premier chantier (best-effort)
    if (affectations[0] !== undefined) {
      accueilChantierId = affectations[0].chantier_id
    }
  }

  // 8. Poser le cookie HttpOnly ouvrier_session
  // D-3-003, D-3-021 : Path=/ obligatoire (pas /ouvrier) pour que le cookie soit
  // transmis aux routes /api/ouvrier/* (diff path de /ouvrier/*)
  // SameSite=Lax : autorise les GET top-level cross-origin (scan QR iOS Safari)
  // Commentaire intentionnel K3-LOW-05 : ne PAS changer en Strict
  const redirectResponse = NextResponse.redirect(
    new URL(redirectPath, baseUrl),
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

  // Sprint 8 — Accueil Claw best-effort (D-8-16 BINDING : jamais bloquer le scan QR)
  // Génère l'accueil Claw du jour et l'insère dans claw_accueil_log
  // getOuvrierSession n'est pas appelable ici (pas de NextRequest cookie encore posé)
  // On lance directement la génération en fire-and-forget
  if (accueilChantierId) {
    void genererEtSauvegarderAccueilClaw(
      user_id,
      accueilChantierId,
      organisation_id,
      adminClient,
    )
  }

  return redirectResponse
}

// ============================================================
// Sprint 8 — Accueil Claw fire-and-forget (D-8-16 best-effort)
// Génère l'accueil Claw et l'insère dans claw_accueil_log
// RG-ACCUEIL-006 : unicité (user_id, date_accueil) via UNIQUE INDEX ON CONFLICT DO NOTHING
// D-051 BINDING : genererAccueilClaw ne retourne jamais note_privee_conducteur
// Ne jamais throw — toute erreur est loggée silencieusement
// ============================================================

async function genererEtSauvegarderAccueilClaw(
  ouvrierUserId: string,
  chantierId: string,
  organisationId: string,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<void> {
  try {
    // Récupérer infos chantier nécessaires
    const { data: chantierRow } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chantiers')
      .select('id, nom, code_postal, organisation_id')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .maybeSingle() as unknown as {
        data: { id: string; nom: string; code_postal: string | null; organisation_id: string } | null
        error: unknown
      }

    if (!chantierRow) {
      logger.warn({ ouvrierUserId, chantierId }, 'genererEtSauvegarderAccueilClaw: chantier introuvable')
      return
    }

    const today = new Date().toISOString().split('T')[0]! // YYYY-MM-DD

    // Générer l'accueil (best-effort — retourne null si erreur)
    const resultat = await genererAccueilClaw(ouvrierUserId, chantierRow, adminClient)

    if (!resultat) {
      // genererAccueilClaw a déjà loggé l'erreur
      return
    }

    // Insérer dans claw_accueil_log — ignoreSuffixKey pour ON CONFLICT DO NOTHING
    // RG-ACCUEIL-006 : UNIQUE INDEX (user_id, date_accueil) — si déjà généré ce jour = skip
    // Supabase upsert avec ignoreDuplicates: true = INSERT ... ON CONFLICT DO NOTHING
    const { error: insertError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('claw_accueil_log')
      .upsert(
        {
          user_id: ouvrierUserId,
          chantier_id: chantierId,
          organisation_id: organisationId, // F002 fix — NOT NULL REFERENCES organisations(id) migration 020 l.20
          date_accueil: today,
          contenu: resultat.contenu,
          meteo_disponible: resultat.meteo_disponible,
          llm_utilise: resultat.llm_utilise,
        } as unknown as import('@/types/database').Database['public']['Tables']['claw_accueil_log']['Insert'],
        { onConflict: 'user_id,date_accueil', ignoreDuplicates: true },
      ) as unknown as { error: { message: string } | null }

    if (insertError) {
      logger.warn(
        { ouvrierUserId, chantierId, error: insertError.message },
        'genererEtSauvegarderAccueilClaw: erreur INSERT (non-bloquant)',
      )
    } else {
      logger.info({ ouvrierUserId, chantierId, date: today }, 'Accueil Claw inséré')
    }
  } catch (err) {
    // D-8-16 : catch global — jamais throw (le scan QR doit toujours réussir)
    logger.warn(
      {
        ouvrierUserId,
        chantierId,
        error: err instanceof Error ? err.message : String(err),
      },
      'genererEtSauvegarderAccueilClaw: erreur inattendue — best-effort silencieux',
    )
  }
}

// ============================================================
// Cas 0 affectation — RG-NO-AFFECTATION-002
// ============================================================
// Recupere le dernier chantier + conducteur et construit un base64url
// pour la page /ouvrier/no-affectation

async function handleNoAffectation(
  baseUrl: string,
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
    new URL(`/ouvrier/no-affectation?data=${dataBase64}`, baseUrl),
  )
  redirectResp.headers.set('Cache-Control', responseHeaders['Cache-Control'] ?? 'no-store')
  return redirectResp
}
