import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, RATE_LIMITS } from '@/lib/redis'
import { toApiResponse } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'
import { renderEmail, sendEmail, escapeHtml } from '@/lib/notifications/email-layout'

// ============================================================
// POST /api/organisations — Création compte + trial 14j
// Route publique (pas d'auth JWT requise — création initiale)
// Rate limit : 10/h/IP (D-02, S-04)
// adminClient utilisé intentionnellement : bypass RLS pour création organisation
// avant qu'une session existe (cas d'usage documenté dans lib/supabase/admin.ts)
// ============================================================

const CreateOrgSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(128),
  name: z.string().min(2).max(100),
  secteur: z.string().min(2).max(100),
})

// Message générique obligatoire (I-04) — ne jamais révéler l'existence d'un compte
const GENERIC_ERROR_MESSAGE = 'Un problème est survenu. Vérifiez vos informations.'

export async function POST(request: NextRequest) {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const correlationId = headerStore.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  try {
    // 1. Extraire IP pour le rate limiting
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      '127.0.0.1'

    // 2. Rate limit AVANT toute logique (anti-abus, D-02)
    const rateLimitResult = await checkRateLimit({
      key: `rate:signup:${ip}`,
      limit: RATE_LIMITS.signup.limit,
      windowMs: RATE_LIMITS.signup.windowMs,
    })

    if (!rateLimitResult.allowed) {
      reqLogger.warn({ ip }, 'Signup rate limit exceeded')
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
      return NextResponse.json(
        { error: 'Corps de requête JSON invalide.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const parsed = CreateOrgSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: GENERIC_ERROR_MESSAGE },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const { email, password, name, secteur } = parsed.data

    // 4. Créer organisation via adminClient (bypass RLS — pas de session active)
    // DANGER: bypass RLS intentionnel — création initiale avant session (lib/supabase/admin.ts)
    const adminClient = createAdminClient()

    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 14)

    const { data: org, error: orgError } = await adminClient
      .from('organisations')
      .insert({
        name,
        plan: 'starter',
        statut: 'trial_active',
        trial_ends_at: trialEndsAt.toISOString(),
      })
      .select('id')
      .single()

    if (orgError || !org) {
      reqLogger.error(
        { error: orgError?.message, correlationId },
        'Failed to create organisation',
      )
      // I-04 — message générique, pas de détail technique
      return NextResponse.json(
        { error: GENERIC_ERROR_MESSAGE },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const organisationId = org.id

    // 5. Créer compte Supabase Auth via adminClient.auth.admin
    // email_confirm: true — l'utilisateur est confirmé immédiatement (pas besoin de vérifier l'email)
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        app_metadata: {
          organisation_id: organisationId,
          role: 'admin',
        },
        email_confirm: true,
      })

    if (authError || !authData.user) {
      // Nettoyage : supprimer l'organisation créée (rollback partiel)
      reqLogger.warn(
        { error: authError?.message, organisationId, correlationId },
        'Failed to create Supabase auth user — rolling back organisation',
      )
      await adminClient.from('organisations').delete().eq('id', organisationId)

      // I-04 — email déjà utilisé : message générique sans révéler l'existence du compte
      return NextResponse.json(
        { error: GENERIC_ERROR_MESSAGE },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const userId = authData.user.id

    // 6. Créer entrée dans la table users (admin, has_supabase_auth=true)
    const { error: userError } = await adminClient.from('users').insert({
      id: userId,
      organisation_id: organisationId,
      role: 'admin',
      // Nom de l'organisation comme nom par défaut (admin principal)
      // Le nom/prenom réels seront saisis lors de l'onboarding (Sprint 2)
      // CHECK (char_length(prenom) >= 1) — valeur placeholder obligatoire
      nom: name,
      prenom: 'Admin',
      email,
      has_supabase_auth: true,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })

    if (userError) {
      reqLogger.error(
        { error: userError.message, userId, organisationId, correlationId },
        'Failed to create users entry — auth user created, DB entry missing',
      )
      // L'utilisateur auth existe mais pas la fiche users — état incohérent
      // Log l'incident pour intervention manuelle, retour générique
      return NextResponse.json(
        { error: GENERIC_ERROR_MESSAGE },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 7. Email de bienvenue via Resend
    // Si RESEND_API_KEY absent : logger warning et continuer (pas de blocage — plan.md §4.2)
    await sendWelcomeEmail({ email, organisationName: name, correlationId, reqLogger })

    reqLogger.info(
      { organisationId, userId, secteur, correlationId },
      'Organisation created successfully',
    )

    // 8. HTTP 201 avec données publiques uniquement (T-01 — pas d'info sensible)
    return NextResponse.json(
      {
        data: {
          organisation_id: organisationId,
          user_id: userId,
        },
      },
      {
        status: 201,
        headers: { 'X-Correlation-Id': correlationId },
      },
    )
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in POST /api/organisations',
    )
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// Email de bienvenue (non-bloquant si RESEND_API_KEY absent)
// Utilise renderEmail + sendEmail de lib/notifications/email-layout.ts
// Template : templates/emails/app/welcome.html
// ============================================================

interface WelcomeEmailParams {
  email: string
  organisationName: string
  correlationId: string
  reqLogger: ReturnType<typeof createRequestLogger>
}

async function sendWelcomeEmail({
  email,
  organisationName,
  correlationId,
  reqLogger,
}: WelcomeEmailParams): Promise<void> {
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://saas-gestion-chantier.tanren-studio.com'

  try {
    const html = renderEmail({
      bodyTemplate: 'welcome',
      title: 'Bienvenue sur ClawBTP',
      preheader: `Votre espace ${organisationName} est prêt — essai gratuit de 14 jours`,
      vars: {
        // escapeHtml() obligatoire sur les valeurs user avant injection dans le template
        ORG_NAME: escapeHtml(organisationName),
        APP_URL: appUrl,
      },
    })

    // sendEmail gere internement : absence RESEND_API_KEY (warn en dev, throw en prod),
    // timeout AbortController 5s, logging via lib/logger.
    await sendEmail({
      to: email,
      subject: `Bienvenue sur ClawBTP — démarrage de votre essai gratuit`,
      html,
      tag: 'welcome',
    })

    reqLogger.info({ email, correlationId }, 'Welcome email sent via Resend')
  } catch (error) {
    // Email non critique — ne pas bloquer la creation de compte (plan.md §4.2)
    reqLogger.warn(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Failed to send welcome email — continuing',
    )
  }
}
