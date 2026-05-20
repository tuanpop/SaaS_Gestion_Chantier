import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { encryptQR } from '@/lib/crypto'
import { toApiResponse, ForbiddenError } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'
import { renderEmail, sendEmail, escapeHtml } from '@/lib/notifications/email-layout'
import { mapEmailErrorToResponse } from '@/lib/notifications/email-errors'
import type { UserRole, Database } from '@/types/database'

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

// R-02 (Sprint UX-2) — telephone ajouté sur le variant conducteur (décision humaine 2026-05-19)
// Le champ est optionnel pour les deux rôles. La colonne users.telephone est nullable
// et déjà utilisée pour les ouvriers depuis Sprint 1.
const InviteUserSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('conducteur'),
    email: z.string().email().max(255),
    nom: z.string().min(1).max(100),
    prenom: z.string().min(1).max(100),
    telephone: z
      .string()
      .regex(/^\+?[0-9]{10,15}$/)
      .optional(),
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
    // deleted_at IS NULL : exclure les membres soft-deleted (migration 003)
    const supabase = await createClient()
    const { data: users, error: dbError } = await supabase
      .from('users')
      .select(
        'id, organisation_id, role, nom, prenom, telephone, email, has_supabase_auth, invitation_status, avatar_url, created_at',
      )
      .eq('organisation_id', organisationId)
      .is('deleted_at', null)
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
        telephone: userData.telephone ?? null,
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
  telephone: string | null
  organisationId: string
  correlationId: string
  reqLogger: ReturnType<typeof createRequestLogger>
}

async function handleCreateConducteur({
  nom,
  prenom,
  email,
  telephone,
  organisationId,
  correlationId,
  reqLogger,
}: CreateConducteurParams): Promise<NextResponse> {
  // DANGER: adminClient pour inviteUserByEmail — opération admin Supabase Auth
  const adminClient = createAdminClient()

  // ── REVIVE CHECK ──────────────────────────────────────────
  // Avant d'appeler inviteUserByEmail (qui crée un nouvel auth user),
  // vérifier si une row soft-deleted existe pour cet email + organisation.
  // Si oui : revive l'ancienne row en réutilisant son UUID public.users
  // pour préserver l'historique (taches.assigned_to, affectations, etc.)
  // et éviter l'accumulation de rows par email en DB.
  const { data: existingDeleted } = await adminClient
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('organisation_id', organisationId)
    .not('deleted_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingDeleted) {
    return await handleReviveConducteur({
      existingId: existingDeleted.id as string,
      email,
      nom,
      prenom,
      telephone,
      organisationId,
      correlationId,
      reqLogger,
    })
  }
  // ── FIN REVIVE CHECK ─────────────────────────────────────

  // Inviter via Supabase Auth (envoie un email d'invitation avec magic link).
  // redirectTo : page qui demande au nouveau conducteur de définir son password
  // avant d'accéder au dashboard. Sans ça, Supabase fallback sur Site URL = home.
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'
  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        organisation_id: organisationId,
        role: 'conducteur',
      },
      // redirectTo : /auth/callback (PKCE exchange) -> /auth/invite (set password).
      // Sans le callback intermédiaire, le code ?code=XYZ n'est jamais échangé
      // contre une session, et le set-password modifie la session déjà présente
      // dans le navigateur (potentiellement celle de l'admin = bug sécurité majeur).
      redirectTo: `${appUrl}/auth/callback?next=/auth/invite`,
    })

  if (inviteError || !inviteData.user) {
    reqLogger.error(
      { error: inviteError?.message, email, organisationId, correlationId },
      'Failed to invite conducteur via Supabase Auth',
    )
    // Convention messages d'erreur (TECH_CONTEXT.md) — mapper les cas métier prévisibles
    // vers des HTTP codes + messages clairs UI plutôt que 500 générique.
    const errMsg = inviteError?.message ?? ''
    if (errMsg.includes('already been registered') || errMsg.includes('already registered')) {
      return NextResponse.json(
        {
          error: 'Cet email est déjà associé à un compte. Demandez à la personne de se connecter directement, ou utilisez une autre adresse.',
        },
        { status: 409, headers: { 'X-Correlation-Id': correlationId } },
      )
    }
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.' },
      { status: 500, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  const newUserId = inviteData.user.id

  // Créer la fiche users (invitation_status='pending')
  // R-02 : telephone propagé depuis le payload (nullable, champ optionnel)
  const { error: userInsertError } = await adminClient.from('users').insert({
    id: newUserId,
    organisation_id: organisationId,
    role: 'conducteur',
    nom,
    prenom,
    email,
    has_supabase_auth: true,
    invitation_status: 'pending',
    telephone,
    qr_token: null,
    avatar_url: null,
  })

  if (userInsertError) {
    reqLogger.error(
      { error: userInsertError.message, newUserId, organisationId, correlationId },
      'Failed to create conducteur users entry — auth user invited, DB entry missing',
    )

    // ROLLBACK : supprimer le nouvel auth user créé par inviteUserByEmail pour
    // éviter un état orphelin (auth.users avec une row, public.users sans).
    // Best-effort : si la suppression échoue, on log mais on retourne quand
    // même l'erreur d'origine (l'orphelin sera nettoyable manuellement).
    await adminClient.auth.admin.deleteUser(newUserId).catch((rollbackErr: unknown) => {
      reqLogger.error(
        {
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
          newUserId,
          correlationId,
        },
        'Rollback failed — auth user orphan, cleanup manuel requis',
      )
    })

    // Convention messages d'erreur (TECH_CONTEXT.md) — mapper le cas duplicate
    // email vers un message utilisateur clair et actionnable.
    const errMsg = userInsertError.message ?? ''
    if (errMsg.includes('idx_users_email') || errMsg.includes('duplicate key')) {
      return NextResponse.json(
        {
          error:
            "Cet email est déjà associé à un membre supprimé de votre organisation. La migration 004 (partial unique index) doit être appliquée — contactez le support.",
        },
        { status: 409, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

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
// Revive conducteur — réactive une row soft-deleted existante
// en réutilisant son ancien UUID (préserve FK historique)
// ============================================================

interface ReviveConducteurParams {
  existingId: string
  nom: string
  prenom: string
  email: string
  telephone: string | null
  organisationId: string
  correlationId: string
  reqLogger: ReturnType<typeof createRequestLogger>
}

async function handleReviveConducteur({
  existingId,
  email,
  nom,
  prenom,
  telephone,
  organisationId,
  correlationId,
  reqLogger,
}: ReviveConducteurParams): Promise<NextResponse> {
  const adminClient = createAdminClient()
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  // 1. Recréer l'auth user avec l'ANCIEN UUID (Supabase createUser accepte id custom).
  //    L'auth user avait été hard-deleted au DELETE. On le recrée maintenant
  //    pour que Supabase Auth connaisse cet utilisateur et puisse générer des liens.
  const { error: createError } = await adminClient.auth.admin.createUser({
    id: existingId,
    email,
    email_confirm: false,
    app_metadata: { organisation_id: organisationId, role: 'conducteur' },
  })

  if (createError) {
    // Cas edge : l'auth user n'avait pas été hard-deleted (DELETE incomplet historique)
    // → message clair pour permettre cleanup manuel, sans exposer les détails internes.
    reqLogger.error(
      { error: createError.message, existingId, email, correlationId },
      'Revive: failed to recreate auth user',
    )
    const msg = createError.message?.toLowerCase() ?? ''
    if (msg.includes('already') || msg.includes('exists')) {
      return NextResponse.json(
        {
          error:
            'Un compte technique résiduel existe pour cet email. Contactez le support pour cleanup (ID: ' +
            existingId +
            ').',
        },
        { status: 409, headers: { 'X-Correlation-Id': correlationId } },
      )
    }
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.' },
      { status: 500, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  // 2. UPDATE row public.users : clear deleted_at + mettre à jour les champs.
  //    Ownership enforced via .eq('organisation_id', organisationId) — T-01.
  // DANGER: adminClient pour bypass RLS — opération admin (même pattern que INSERT ouvrier)
  // deleted_at absent du type généré database.ts (DECISIONLOG 2026-05-19).
  // RejectExcessProperties de supabase-js rejette Record<string, unknown> directement.
  // Workaround : construire le payload avec le type Update exact, puis caster uniquement
  // `deleted_at: null` (champ absent du type généré) via `as unknown as UsersUpdate`.
  // À régénérer (type + ce cast) après `supabase db pull` en prod post-migration 003.
  type UsersUpdate = Database['public']['Tables']['users']['Update']
  const revivePayload: UsersUpdate & { deleted_at: null } = {
    nom,
    prenom,
    role: 'conducteur',
    telephone,
    invitation_status: 'pending',
    has_supabase_auth: true,
    deleted_at: null,
  }
  const { error: updateError } = await adminClient
    .from('users')
    .update(revivePayload as unknown as UsersUpdate)
    .eq('id', existingId)
    .eq('organisation_id', organisationId)

  if (updateError) {
    // Rollback : supprimer l'auth user qu'on vient de créer pour éviter un état
    // où auth.users a une row mais public.users reste soft-deleted (orphelin).
    await adminClient.auth.admin.deleteUser(existingId).catch(() => {
      // Best-effort — si le rollback échoue, l'orphelin sera nettoyé manuellement.
    })
    reqLogger.error(
      { error: updateError.message, existingId, correlationId },
      'Revive: failed to update public.users — rolled back auth',
    )
    return NextResponse.json(
      { error: 'Une erreur interne est survenue.' },
      { status: 500, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  // 3. Générer un lien d'invitation pour que le conducteur réactivé puisse se connecter.
  //    type='invite' (vs 'magiclink') : 24h d'expiration au lieu de 1h, et
  //    sémantiquement adapté au flow set-password sur /auth/invite. Moins fragile
  //    aux Gmail/Outlook preview crawlers qui peuvent consommer les magic links
  //    avant le clic réel de l'utilisateur (bug observé 2026-05-20).
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'invite',
    email,
    // redirectTo /auth/callback : PKCE code exchange obligatoire (cf. commentaire
    // dans handleCreateConducteur ci-dessus + bug observé prod 2026-05-20).
    options: { redirectTo: `${appUrl}/auth/callback?next=/auth/invite` },
  })

  if (linkError || !linkData?.properties?.action_link) {
    reqLogger.error(
      { error: linkError?.message, existingId, correlationId },
      'Revive: failed to generate link — user revived but no email sent',
    )
    // L'utilisateur EST revived (public.users cleared) mais sans email.
    // L'admin peut cliquer "Renvoyer" depuis l'UI pour renvoyer l'invitation.
    return NextResponse.json(
      {
        data: { user_id: existingId, invitation_status: 'pending', email, revived: true },
        warning:
          'Compte réactivé mais email non envoyé. Cliquez "Renvoyer" depuis la liste équipe.',
      },
      { status: 201, headers: { 'X-Correlation-Id': correlationId } },
    )
  }

  // 4. Envoyer l'email via Resend avec le template branded.
  //    Même template que reinvite (bodyTemplate: 'invitation-renvoi').
  const html = renderEmail({
    bodyTemplate: 'invitation-renvoi',
    title: 'Activez votre compte ClawBTP',
    preheader: 'Vous avez ete invite(e) a rejoindre ClawBTP',
    vars: {
      PRENOM: escapeHtml(prenom),
      NOM: escapeHtml(nom),
      ACTION_URL: linkData.properties.action_link,
    },
  })

  try {
    await sendEmail({
      to: email,
      subject: 'Activez votre compte ClawBTP',
      html,
      tag: 'invite-revive',
    })
  } catch (emailErr) {
    // Convention : ne pas rollback le revive (le user EST revived, juste l'email pas parti).
    // L'admin peut renvoyer via "Renvoyer" dans l'UI. Mapper l'erreur avec le helper DRY.
    reqLogger.error(
      {
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
        existingId,
        email,
        correlationId,
      },
      'Revive: failed to send email via Resend — user revived, email not sent',
    )
    return mapEmailErrorToResponse(emailErr, correlationId)
  }

  reqLogger.info(
    { existingId, email, organisationId, correlationId },
    'Conducteur revived successfully',
  )

  return NextResponse.json(
    { data: { user_id: existingId, invitation_status: 'pending', email, revived: true } },
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
