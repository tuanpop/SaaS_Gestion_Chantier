import { createServerClient, type CookieOptions } from '@supabase/ssr'
// await cookies() et await headers() OBLIGATOIRES — Next.js 15 breaking change (D-011)
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createRequestLogger } from '@/lib/logger'
import type { Database } from '@/types/database'
import type { UserRole } from '@/types/database'

// ============================================================
// Routes publiques — bypass du check JWT
// ============================================================

const PUBLIC_ROUTES = new Set([
  // API publiques
  '/api/organisations',     // POST — création compte (public, rate limited)
  '/api/auth/login',        // POST — connexion email+password
  '/api/auth/magic-link',   // POST — envoi magic link
  '/api/health',            // GET — health check (toujours public)
  // Pages publiques (utilisateur non encore loggé)
  '/',                      // landing
  '/login',                 // page connexion
  '/register',              // page création compte
  '/signup',                // alias /register (redirect côté serveur)
  '/auth/invite',           // page set-password post-invitation (session via magic link)
  '/auth/callback',         // PKCE code exchange Supabase (crée la session du user invité)
])

// Préfixes publics — toute URL commençant par un de ces préfixes est publique
// (utilisé pour les routes dynamiques type /qr/:token Sprint 3)
const PUBLIC_PREFIXES = [
  '/qr/',                   // legacy — conservé pour compatibilité
  '/api/auth/qr/',          // Sprint 3 — handler QR scan ouvrier (token = credential, pas de JWT)
]

// ============================================================
// Routes ouvrier exemptées du check de session ouvrier
// Ces pages sont publiques car l'ouvrier n'a pas encore de session
// ============================================================
const OUVRIER_PUBLIC_ROUTES = [
  '/ouvrier/scan',
  '/ouvrier/no-affectation',
]

// Routes admin seulement (rôle vérifié côté middleware)
// Les routes /api/users/* nécessitent le rôle 'admin'
const ADMIN_ONLY_PATTERNS = [
  /^\/api\/users(\/.*)?$/,
]

// ============================================================
// Helper : extraire l'IP réelle (derrière Traefik)
// ============================================================

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '127.0.0.1'
  )
}

// ============================================================
// Middleware Next.js
// ============================================================

export async function middleware(request: NextRequest) {
  // 1. Générer correlationId — propagé dans tous les logs de la requête
  const correlationId = crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  reqLogger.debug(
    {
      method: request.method,
      url: request.nextUrl.pathname,
      ip: getClientIp(request),
    },
    'Request received',
  )

  // 2. Créer la réponse de base avec correlationId dans les headers
  let response = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  })

  // Injecter correlationId dans les headers de réponse (debugging)
  response.headers.set('X-Correlation-Id', correlationId)
  // Injecter correlationId dans les headers de requête pour les Server Components
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-correlation-id', correlationId)

  // 3. Routes publiques — bypass JWT check
  const pathname = request.nextUrl.pathname
  const isPublic =
    PUBLIC_ROUTES.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  if (isPublic) {
    reqLogger.debug({ pathname }, 'Public route — bypassing auth check')
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // 3b. Routes ouvrier — branche orthogonale AVANT le check JWT Supabase
  // D-3-001 : middleware Edge leger — verification cookie presence uniquement
  // D-052/PO-3-06 : JAMAIS d'appel Redis en Edge runtime
  // Les ouvriers n'ont pas de JWT Supabase — ils ne doivent PAS passer par le check JWT
  const isOuvrierPage = pathname.startsWith('/ouvrier/')
  const isOuvrierApi = pathname.startsWith('/api/ouvrier/')

  if (isOuvrierPage || isOuvrierApi) {
    // Pages exemptées (scan QR, no-affectation) — pas de session requise
    if (OUVRIER_PUBLIC_ROUTES.some((p) => pathname.startsWith(p))) {
      reqLogger.debug({ pathname }, 'Ouvrier public route — bypassing session check')
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    // Vérification Edge légère : cookie ouvrier_session présent ?
    // La validation Redis complète est faite handler-level (D-3-002)
    const sessionId = request.cookies.get('ouvrier_session')?.value

    if (!sessionId) {
      reqLogger.warn({ pathname }, 'Ouvrier route — cookie absent')
      if (isOuvrierApi) {
        // Routes API ouvrier → JSON 401 (D-033)
        return NextResponse.json(
          { error: 'Session expirée. Reconnectez-vous.' },
          { status: 401, headers: { 'X-Correlation-Id': correlationId } },
        )
      }
      // Pages ouvrier → redirect /ouvrier/scan
      const redirectResp = NextResponse.redirect(
        new URL('/ouvrier/scan', request.url),
      )
      // Supprimer le cookie invalide s'il existe avec une valeur vide
      redirectResp.cookies.delete('ouvrier_session')
      return redirectResp
    }

    // Cookie présent → laisser passer vers le handler Node (validation Redis complète D-3-002)
    reqLogger.debug({ pathname }, 'Ouvrier route — cookie présent, forwarding to handler')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // 4. Créer le client Supabase côté serveur pour le middleware
  // await cookies() OBLIGATOIRE — Next.js 15 (D-011)
  const cookieStore = await cookies()

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']

  if (!supabaseUrl || !supabaseAnonKey) {
    reqLogger.error('Supabase env vars manquantes dans middleware')
    return NextResponse.json(
      { error: 'Configuration serveur invalide.' },
      { status: 500 },
    )
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          requestHeaders.set('cookie', `${name}=${value}`)
          response = NextResponse.next({
            request: { headers: requestHeaders },
          })
          response.cookies.set(name, value, options)
          response.headers.set('X-Correlation-Id', correlationId)
        })
      },
    },
  })

  // 5. Vérification JWT — getUser() est la méthode sécurisée (getSession() ne valide pas côté serveur)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  // Distinguer les requêtes API (retourner JSON) des requêtes de pages (rediriger)
  // Les routes API commencent par /api/ — toutes les autres sont des pages
  const isApiRoute = pathname.startsWith('/api/')

  if (authError || !user) {
    reqLogger.warn(
      {
        pathname,
        authError: authError?.message,
        hasUser: !!user,
      },
      'Unauthorized — missing or invalid JWT',
    )
    // Routes API → JSON 401 (attendu par le client fetch)
    // Routes de pages → redirect /login (évite la 404 Next.js sur réponse JSON inattendue)
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        {
          status: 401,
          headers: { 'X-Correlation-Id': correlationId },
        },
      )
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // 6. Extraire organisation_id et role depuis app_metadata (injectés par l'Auth Hook)
  // JAMAIS depuis req.body ou query params (T-01)
  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  const role = user.app_metadata?.['role'] as UserRole | undefined

  if (!organisationId || !role) {
    reqLogger.warn(
      { userId: user.id, pathname },
      'JWT valide mais claims organisation_id/role manquants — auth-hook non configuré ?',
    )
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'Claims JWT invalides. Contactez le support.' },
        {
          status: 401,
          headers: { 'X-Correlation-Id': correlationId },
        },
      )
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 7. RBAC — routes admin uniquement (E-01)
  // Vérification CÔTÉ SERVEUR — jamais côté client uniquement
  const isAdminOnlyRoute = ADMIN_ONLY_PATTERNS.some((pattern) =>
    pattern.test(pathname),
  )

  if (isAdminOnlyRoute && role !== 'admin') {
    reqLogger.warn(
      { userId: user.id, role, pathname },
      'Forbidden — admin role required',
    )
    return NextResponse.json(
      { error: 'Accès refusé.' },
      {
        status: 403,
        headers: { 'X-Correlation-Id': correlationId },
      },
    )
  }

  // 8. Injecter les claims dans les headers de requête pour les Route Handlers
  // Les handlers extraient organisation_id et role depuis ces headers (T-01)
  requestHeaders.set('x-user-id', user.id)
  requestHeaders.set('x-organisation-id', organisationId)
  requestHeaders.set('x-user-role', role)
  requestHeaders.set('x-correlation-id', correlationId)

  reqLogger.debug(
    {
      userId: user.id,
      organisationId,
      role,
      pathname,
    },
    'Request authenticated',
  )

  // 9. Refresh session si nécessaire (Supabase SSR gère cela via setAll ci-dessus)
  const finalResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })
  finalResponse.headers.set('X-Correlation-Id', correlationId)

  // Propager les cookies de session mis à jour (refresh JWT par Supabase SSR).
  // Forme single-arg : conserve TOUTES les options (httpOnly, secure, sameSite, maxAge…).
  // Le passage par 3 args sans options écraserait httpOnly/secure → XSS + risque SameSite.
  response.cookies.getAll().forEach((cookie) => {
    finalResponse.cookies.set(cookie)
  })

  return finalResponse
}

// ============================================================
// Matcher — routes couvertes par le middleware
// ============================================================

export const config = {
  matcher: [
    // Routes API protégées
    '/api/:path*',
    // Interfaces par persona — segments URL réels (pas route groups)
    // Les dossiers app/admin/, app/conducteur/ et app/ouvrier/ sont des segments URL
    // (pas des route groups Next.js qui auraient des parenthèses dans le nom de dossier).
    '/admin/:path*',
    '/conducteur/:path*',
    // Sprint 3 — routes ouvrier (branche Edge légère D-3-001)
    '/ouvrier/:path*',
    // Catch-all — exclure les assets Next.js et fichiers statiques
    // Couvre /, /login, /register et toutes les autres routes publiques
    // (filtrées dans le code via PUBLIC_ROUTES / PUBLIC_PREFIXES)
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
