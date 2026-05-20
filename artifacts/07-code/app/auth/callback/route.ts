import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { logger } from '@/lib/logger'
import type { Database } from '@/types/database'

// ============================================================
// GET /auth/callback — Échange du code Supabase Auth contre une session
//
// Flow attendu :
//   1. Admin invite un user → inviteUserByEmail (ou generateLink('invite'))
//      avec redirectTo: ${APP_URL}/auth/callback?next=/auth/invite
//   2. Le user clique le lien email
//   3. Supabase Auth verify → redirige vers /auth/callback?code=XYZ&next=/auth/invite
//   4. Ce handler échange le code contre une session JWT du user INVITÉ
//      (et non pas n'importe quelle session admin déjà présente dans le navigateur)
//   5. Redirect vers `next` (par défaut /auth/invite pour set-password)
//
// SÉCURITÉ CRITIQUE :
//   Sans ce handler, le code dans l'URL n'est jamais échangé. Si un admin est déjà
//   connecté et clique le lien d'un conducteur invité, sa session admin reste active
//   sur /auth/invite — et le set-password modifie le password de l'admin au lieu du
//   conducteur. Bug observé prod 2026-05-20.
//
// PKCE-compatible (flow v2 Supabase Auth).
// ============================================================

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/auth/invite'

  // Garde : `next` doit être un chemin relatif local pour éviter l'open redirect
  // (sinon un attaquant pourrait passer next=https://evil.com)
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/auth/invite'

  if (!code) {
    logger.warn(
      { searchParams: searchParams.toString() },
      'auth/callback: missing code parameter',
    )
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  // Préparer la NextResponse de redirection vers `next`, sur laquelle Supabase
  // va écrire les cookies de session (pattern identique au login route fix D-032).
  const response = NextResponse.redirect(`${origin}${safeNext}`)

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.error('auth/callback: missing Supabase env vars')
    return NextResponse.redirect(`${origin}/login?error=config`)
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    logger.warn(
      { error: error.message, code: code.slice(0, 8) + '...' },
      'auth/callback: exchangeCodeForSession failed',
    )
    // Codes typiques : expired, already_used, invalid_grant
    // On redirige vers /auth/invite SANS session — la page affichera son message
    // UX clair "lien expiré/consommé" avec les 4 causes possibles.
    return NextResponse.redirect(`${origin}${safeNext}?error=link_invalid`)
  }

  logger.info({ next: safeNext }, 'auth/callback: session exchanged successfully')
  return response
}
