import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, RATE_LIMITS } from '@/lib/redis'
import { toApiResponse } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'

// ============================================================
// POST /api/auth/login — Connexion email + password
// Route publique (voir middleware.ts PUBLIC_API_ROUTES)
// Rate limit : 5/15min/IP (D-01, S-03)
// Le compteur Redis est incrémenté AVANT l'appel Supabase pour éviter les timing attacks
// ============================================================

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
})

// Message d'erreur générique obligatoire (I-04, US-002 S3)
// Ne jamais révéler si l'email existe ou si le mot de passe est incorrect
const GENERIC_AUTH_ERROR = 'Un problème est survenu. Vérifiez vos informations.'

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

    // 2. Rate limit AVANT toute requête Supabase (anti timing attack — plan.md §4.3)
    // Le compteur est incrémenté même si la tentative sera invalide
    const rateLimitResult = await checkRateLimit({
      key: `rate:login:${ip}`,
      limit: RATE_LIMITS.login.limit,
      windowMs: RATE_LIMITS.login.windowMs,
    })

    if (!rateLimitResult.allowed) {
      reqLogger.warn({ ip, correlationId }, 'Login rate limit exceeded')
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

    // 3. Validation input (AVANT appel Supabase — ne jamais accéder à request.body directement)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: GENERIC_AUTH_ERROR },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const parsed = LoginSchema.safeParse(body)
    if (!parsed.success) {
      // I-04 — message générique, pas de détail sur le champ invalide
      return NextResponse.json(
        { error: GENERIC_AUTH_ERROR },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const { email, password } = parsed.data

    // 4. Tentative de connexion via Supabase Auth
    // await createClient() OBLIGATOIRE — Next.js 15 (D-011)
    const supabase = await createClient()

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({ email, password })

    if (authError || !authData.user || !authData.session) {
      // I-04 — toujours le même message, quelle que soit la raison de l'échec
      reqLogger.warn(
        { ip, correlationId, hasError: !!authError },
        'Login attempt failed',
      )
      return NextResponse.json(
        { error: GENERIC_AUTH_ERROR },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 5. Succès — extraire les claims depuis app_metadata (injectés par l'Auth Hook)
    // T-01 : organisation_id vient du JWT, jamais du body
    const user = authData.user
    const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
    const role = user.app_metadata?.['role'] as string | undefined

    reqLogger.info(
      { userId: user.id, organisationId, role, correlationId },
      'Login successful',
    )

    // 6. HTTP 200 avec données utilisateur publiques uniquement
    return NextResponse.json(
      {
        data: {
          user: {
            id: user.id,
            email: user.email,
            role: role ?? null,
            organisation_id: organisationId ?? null,
          },
        },
      },
      {
        status: 200,
        headers: { 'X-Correlation-Id': correlationId },
      },
    )
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in POST /api/auth/login',
    )
    return toApiResponse(error, correlationId)
  }
}
