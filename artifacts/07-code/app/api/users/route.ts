import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { encryptQR } from '@/lib/crypto'
import { toApiResponse, ForbiddenError } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// GET /api/users — Liste des membres (admin uniquement)
// POST /api/users — Invitation conducteur OU création ouvrier (admin uniquement)
//
// T-01 : organisation_id et role extraits UNIQUEMENT depuis les headers
// injectés par le middleware (jamais depuis req.body)
// D-012 : assertTrialActive() appelé sur toutes les mutations
// ============================================================

// ============================================================
// Schéma Zod — discriminatedUnion sur 'role' (plan.md §5.1)
// ============================================================

const InviteUserSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('conducteur'),
    email: z.string().email().max(255),
    nom: z.string().min(1).max(100),
    prenom: z.string().min(1).max(100),
  }),
  z.object({
    role: z.literal('ouvrier'),
    nom: z.string().min(1).max(100),
    prenom: z.string().min(1).max(100),
    telephone: z
      .string()
      .regex(/^\+?[0-9]{10,15}$/)
      .optional(),
  }),
])

// ============================================================
// Helper : extraire les claims depuis les headers middleware (T-01)
// ============================================================

function extractMiddlewareClaims(headerStore: Headers): {
  organisationId: string | null
  role: UserRole | null
  userId: string | null
  correlationId: string
} {
  return {
    organisationId: headerStore.get('x-organisation-id'),
    role: headerStore.get('x-user-role') as UserRole | null,
    userId: headerStore.get('x-user-id'),
    correlationId: headerStore.get('x-correlation-id') ?? crypto.randomUUID(),
  }
}

// ============================================================
// GET /api/users
// ============================================================

export async function GET(request: NextRequest) {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const { organisationId, role, correlationId } = extractMiddlewareClaims(headerStore)
  const reqLogger = createRequestLogger(correlationId)

  // Suppression de la variable inutilisée 'request' via destructuring
  void request

  try {
    // 1. Vérification rôle admin (le middleware le fait aussi, mais défense en profondeur)
    if (!organisationId || !role) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    if (role !== 'admin') {
      reqLogger.warn({ role, correlationId }, 'Non-admin tried to access GET /api/users')
      throw new ForbiddenError()
    }

    // 2. Requête DB — organisation_id depuis le JWT (T-01, I-01 via RLS)
    // qr_token exclu du SELECT (ne jamais exposer le token chiffré)
    const supabase = await createClient()
    const { data: users, error: dbError } = await supabase
      .from('users')
      .select(
        'id, organisation_id, role, nom, prenom, telephone, email, has_supabase_auth, invitation_status, avatar_url, created_at',
      )
      .eq('organisation_id', organisationId)
      .order('created_at', { ascending: true })

    if (dbError) {
      reqLogger.error(
        { error: dbError.message, organisationId, correlationId },
        'Failed to fetch users',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    reqLogger.info(
      { organisationId, count: users?.length ?? 0, correlationId },
      'Users list fetched',
    )

    return NextResponse.json(
      { data: users ?? [] },
      { status: 200, headers: { 'X-Correlation-Id': correlationId } },
    )
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in GET /api/users',
    )
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// POST /api/users
// ============================================================

export async function POST(request: NextRequest) {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const { organisationId, role, correlationId } = extractMiddlewareClaims(headerStore)
  const reqLogger = createRequestLogger(correlationId)

  try {
    // 1. Vérification auth claims présents
    if (!organisationId || !role) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 2. Vérification rôle admin (T-01, E-01)
    if (role !== 'admin') {
      reqLogger.warn({ role, correlationId }, 'Non-admin tried to POST /api/users')
      throw new ForbiddenError()
    }

    // 3. D-012 — assertTrialActive AVANT toute mutation
    const supabase = await createClient()
    await assertTrialActive(supabase, organisationId)

    // 4. Validation input
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Corps de requête JSON invalide.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const parsed = InviteUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Requête invalide.', fields: parsed.error.flatten().fieldErrors },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const userData = parsed.data

    if (userData.role === 'conducteur') {
      return await handleCreateConducteur({
        nom: userData.nom,
        prenom: userData.prenom,
        email: userData.email,
        organisationId,
        correlationId,
        reqLogger,
      })
    } else {
      // userData.role === 'ouvrier'
      return await handleCreateOuvrier({
        nom: userData.nom,
        prenom: userData.prenom,
        telephone: userData.telephone ?? null,
        organisationId,
        correlationId,
        reqLogger,
      })
    }
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in POST /api/users',
    )
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// Création conducteur — invitation par email
// adminClient utilisé pour inviteUserByEmail (opération admin Supabase Auth)
// ============================================================

interface CreateConducteurParams {
  nom: string
  prenom: string
  email: string
  organisationId: string
  correlationId: string
  reqLogger: ReturnType<typeof createRequestLogger>
}

async function handleCreateConducteur({
  nom,
  prenom,
  email,
  organisationId,
  correlationId,
  reqLogger,
}: CreateConducteurParams): Promise<NextResponse> {
  // DANGER: adminClient pour inviteUserByEmail — opération admin Supabase Auth
  const adminClient = createAdminClient()

  // Inviter via Supabase Auth (envoie un email d'invitation avec magic link)
  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        organisation_id: organisationId,
        role: 'conducteur',
      },
    })

  if (inviteError || !inviteData.user) {
    reqLogger.error(
      { error: inviteError?.message, email, organisationId, correlationId },
      'Failed to invite conducteur via Supabase Auth',
    )
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.' },
      { status: 500, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  const newUserId = inviteData.user.id

  // Créer la fiche users (invitation_status='pending')
  const { error: userInsertError } = await adminClient.from('users').insert({
    id: newUserId,
    organisation_id: organisationId,
    role: 'conducteur',
    nom,
    prenom,
    email,
    has_supabase_auth: true,
    invitation_status: 'pending',
    telephone: null,
    qr_token: null,
    avatar_url: null,
  })

  if (userInsertError) {
    reqLogger.error(
      { error: userInsertError.message, newUserId, organisationId, correlationId },
      'Failed to create conducteur users entry — auth user invited, DB entry missing',
    )
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.' },
      { status: 500, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  reqLogger.info(
    { newUserId, organisationId, correlationId },
    'Conducteur invited successfully',
  )

  return NextResponse.json(
    {
      data: {
        user_id: newUserId,
        role: 'conducteur',
        invitation_status: 'pending',
      },
    },
    { status: 201, headers: { 'X-Correlation-Id': correlationId } },
  )
}

// ============================================================
// Création ouvrier — pas de compte Supabase Auth (US-003 DoD)
// QR code généré côté serveur uniquement (S-01)
// ============================================================

interface CreateOuvrierParams {
  nom: string
  prenom: string
  telephone: string | null
  organisationId: string
  correlationId: string
  reqLogger: ReturnType<typeof createRequestLogger>
}

async function handleCreateOuvrier({
  nom,
  prenom,
  telephone,
  organisationId,
  correlationId,
  reqLogger,
}: CreateOuvrierParams): Promise<NextResponse> {
  // Générer un UUID pour l'ouvrier (pas de compte Supabase Auth)
  const newUserId = crypto.randomUUID()

  // Générer le QR token AES-256-GCM (S-01 — côté serveur uniquement)
  let qrToken: string
  try {
    qrToken = encryptQR({ user_id: newUserId, organisation_id: organisationId })
  } catch (cryptoError) {
    reqLogger.error(
      { error: cryptoError instanceof Error ? cryptoError.message : String(cryptoError), correlationId },
      'Failed to generate QR token for ouvrier',
    )
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.' },
      { status: 500, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  // adminClient pour bypass RLS — création ouvrier par l'admin
  // L'ouvrier n'a pas de session, donc RLS ne peut pas être satisfaite via JWT client
  // DANGER: bypass RLS intentionnel — insertion fiche ouvrier par admin
  const adminClient = createAdminClient()

  const { error: userInsertError } = await adminClient.from('users').insert({
    id: newUserId,
    organisation_id: organisationId,
    role: 'ouvrier',
    nom,
    prenom,
    email: null,               // ouvriers sans email (US-003 DoD)
    has_supabase_auth: false,  // pas de compte Supabase Auth (US-003 DoD)
    qr_token: qrToken,         // token AES-256-GCM (S-01)
    invitation_status: null,   // pas d'invitation pour les ouvriers
    telephone,
    avatar_url: null,
  })

  if (userInsertError) {
    reqLogger.error(
      { error: userInsertError.message, newUserId, organisationId, correlationId },
      'Failed to create ouvrier',
    )
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.' },
      { status: 500, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  reqLogger.info(
    { newUserId, organisationId, correlationId },
    'Ouvrier created successfully',
  )

  // qr_token exclu de la réponse (jamais exposé via l'API — S-01)
  return NextResponse.json(
    {
      data: {
        user_id: newUserId,
        role: 'ouvrier',
        has_supabase_auth: false,
      },
    },
    { status: 201, headers: { 'X-Correlation-Id': correlationId } },
  )
}
