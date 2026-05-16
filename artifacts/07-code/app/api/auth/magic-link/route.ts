import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, RATE_LIMITS } from '@/lib/redis'
import { toApiResponse } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'

// ============================================================
// POST /api/auth/magic-link — Magic Link OTP (admin + conducteur uniquement)
// Route publique (voir middleware.ts PUBLIC_API_ROUTES)
// Rate limit : 5/15min/IP (D-01)
//
// I-04 : réponse TOUJOURS identique, que l'email existe ou non
// => évite l'énumération d'emails (user story US-002 S2)
// OTP valable 15 min (configuré dans Supabase dashboard)
// shouldCreateUser: false — n'autorise pas la création d'un nouveau compte via OTP (D-002)
// ============================================================

const MagicLinkSchema = z.object({
  email: z.string().email(),
})

// Réponse identique succès / email inconnu (I-04)
const FICTITIOUS_SUCCESS = "Lien envoyé si l'adresse est valide."

export async function POST(request: NextRequest) {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const correlationId = headerStore.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  try {
    // 1. Extraire IP
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      '127.0.0.1'

    // 2. Rate limit AVANT toute logique
    const rateLimitResult = await checkRateLimit({
      key: `rate:magic:${ip}`,
      limit: RATE_LIMITS.magicLink.limit,
      windowMs: RATE_LIMITS.magicLink.windowMs,
    })

    if (!rateLimitResult.allowed) {
      reqLogger.warn({ ip, correlationId }, 'Magic link rate limit exceeded')
      return NextResponse.json(
        { error: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.' },
        {
          status: 429,
          headers: {
            'X-Correlation-Id': correlationId,
            'Retry-After': String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)),
          },
        },
      )
    }

    // 3. Validation input
    let body: unknown
    try {
      body = await request.json()
    } catch {
      // I-04 — retourner le succès fictif même sur corps invalide
      // pour éviter de révéler la structure attendue par timing
      return NextResponse.json(
        { data: { message: FICTITIOUS_SUCCESS } },
        { status: 200, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const parsed = MagicLinkSchema.safeParse(body)
    if (!parsed.success) {
      // I-04 — succès fictif (éviter l'énumération via validation errors)
      return NextResponse.json(
        { data: { message: FICTITIOUS_SUCCESS } },
        { status: 200, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const { email } = parsed.data

    // 4. Vérifier que l'email correspond à un user avec has_supabase_auth = true
    // (admin/conducteur uniquement — les ouvriers n'ont pas de compte Supabase Auth)
    // await createClient() OBLIGATOIRE — Next.js 15 (D-011)
    const supabase = await createClient()

    const { data: userRecord } = await supabase
      .from('users')
      .select('id, has_supabase_auth')
      .eq('email', email)
      .eq('has_supabase_auth', true)
      .single()

    if (!userRecord) {
      // I-04 — email non trouvé ou ouvrier sans auth : succès fictif
      // Ne jamais révéler que l'adresse n'existe pas
      reqLogger.debug(
        { correlationId },
        'Magic link: user not found or no supabase auth — returning fictitious success',
      )
      return NextResponse.json(
        { data: { message: FICTITIOUS_SUCCESS } },
        { status: 200, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 5. Envoyer le magic link OTP via Supabase Auth
    // shouldCreateUser: false — D-002 (enable_signup=false, pas de création silencieuse)
    // OTP valable 15 min (configurable dans Supabase dashboard)
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
      },
    })

    if (otpError) {
      // Log l'erreur en interne mais retourner succès fictif (I-04)
      reqLogger.warn(
        { error: otpError.message, correlationId },
        'Magic link OTP send failed — returning fictitious success',
      )
    } else {
      reqLogger.info(
        { correlationId },
        'Magic link OTP sent successfully',
      )
    }

    // 6. Retour identique succès/échec (I-04)
    return NextResponse.json(
      { data: { message: FICTITIOUS_SUCCESS } },
      { status: 200, headers: { 'X-Correlation-Id': correlationId } },
    )
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in POST /api/auth/magic-link',
    )
    return toApiResponse(error, correlationId)
  }
}
