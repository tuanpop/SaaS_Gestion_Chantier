import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { toApiResponse, ForbiddenError, NotFoundError } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'
import { renderEmail, sendEmail, escapeHtml } from '@/lib/notifications/email-layout'
import { mapEmailErrorToResponse } from '@/lib/notifications/email-errors'
import type { UserRole, Tables } from '@/types/database'

// ============================================================
// POST /api/users/[id]/reinvite — Renvoi invitation (admin uniquement)
//
// Préconditions :
//   - user.invitation_status IN ('pending', 'expired') — sinon HTTP 409
//     Cas 'pending' : email perdu en spam, conducteur n'a pas cliqué à temps
//     Cas 'expired' : invitation Supabase expirée, besoin d'un nouveau lien
//     Cas 'active' : refusé — utilisateur déjà connecté, aucune action requise
// D-012 : assertTrialActive() obligatoire sur cette mutation
// T-01 : ownership check par organisation_id depuis JWT (jamais depuis body)
// S-03 : inviteUserByEmail via adminClient (nouvelle invitation Supabase Auth)
// ============================================================

const IdParamSchema = z.string().uuid('Le paramètre id doit être un UUID valide.')

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const correlationId = headerStore.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  void request

  try {
    // 1. Extraire claims depuis headers middleware (T-01)
    const organisationId = headerStore.get('x-organisation-id')
    const role = headerStore.get('x-user-role') as UserRole | null

    if (!organisationId || !role) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 2. Vérification rôle admin
    if (role !== 'admin') {
      reqLogger.warn(
        { role, correlationId },
        'Non-admin tried to POST /api/users/[id]/reinvite',
      )
      throw new ForbiddenError()
    }

    // 3. D-012 — assertTrialActive AVANT toute mutation
    const supabase = await createClient()
    await assertTrialActive(supabase, organisationId)

    // 4. Valider le paramètre [id]
    const resolvedParams = await params
    const idParsed = IdParamSchema.safeParse(resolvedParams.id)
    if (!idParsed.success) {
      return NextResponse.json(
        { error: 'Identifiant invalide.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const userId = idParsed.data

    // 5. Récupérer le user avec ownership check (T-01)
    // Cast explicite : createServerClient résout Schema différemment de createClient,
    // ce qui donne 'never' sans annotation. Tables<'users'> est le type correct.
    const { data: userRecord, error: dbError } = await supabase
      .from('users')
      .select('id, organisation_id, role, nom, prenom, email, invitation_status')
      .eq('id', userId)
      .eq('organisation_id', organisationId)
      .single() as { data: Pick<Tables<'users'>, 'id' | 'organisation_id' | 'role' | 'nom' | 'prenom' | 'email' | 'invitation_status'> | null; error: { message: string } | null }

    if (dbError || !userRecord) {
      reqLogger.warn(
        { userId, organisationId, error: dbError?.message, correlationId },
        'Reinvite: user not found or not in organisation',
      )
      throw new NotFoundError('user')
    }

    // 6. Vérifier que l'invitation est renvoyable :
    //    - 'pending' : OK (email perdu en spam, non cliqué)
    //    - 'expired' : OK (lien expiré, nouveau lien requis)
    //    - 'active'  : refusé — utilisateur déjà connecté, aucune invitation requise
    //    - null      : refusé — ouvriers sans invitation email
    if (userRecord.invitation_status === 'active') {
      reqLogger.warn(
        { userId, invitationStatus: userRecord.invitation_status, correlationId },
        'Reinvite: user is already active',
      )
      return NextResponse.json(
        {
          error: 'Cet utilisateur a déjà activé son compte. Aucune nouvelle invitation requise.',
        },
        { status: 409, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    if (userRecord.invitation_status !== 'pending' && userRecord.invitation_status !== 'expired') {
      reqLogger.warn(
        { userId, invitationStatus: userRecord.invitation_status, correlationId },
        'Reinvite: invitation status does not allow reinvite',
      )
      return NextResponse.json(
        {
          error: 'Impossible de renvoyer une invitation pour cet utilisateur.',
        },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 7. Vérifier que l'email est présent (conducteur uniquement)
    const email = userRecord.email
    if (!email) {
      reqLogger.warn(
        { userId, correlationId },
        'Reinvite: no email on user record',
      )
      return NextResponse.json(
        { error: 'Cet utilisateur n\'a pas d\'adresse email.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 8. Renvoyer l'invitation via generateLink + Resend
    // DANGER: bypass RLS intentionnel — opération admin
    //
    // POURQUOI generateLink au lieu de inviteUserByEmail ? (bug observé 2026-05-19)
    // inviteUserByEmail CRÉE un nouvel auth user. Si l'auth user existe déjà
    // (cas typique : 1re invitation envoyée mais jamais cliquée), 422 "already
    // been registered". generateLink('invite') marche pour un user existant,
    // retourne le lien (sans envoyer l'email — on l'envoie nous-mêmes via Resend
    // avec notre template branded).
    const adminClient = createAdminClient()
    const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    // 8a. Vérifier que l'auth user existe encore (cas edge : suppression manuelle Dashboard)
    // Si l'auth user est absent, generateLink retourne "user not found" → 404 bloquant pour
    // l'admin. Stratégie de résilience : recréer l'auth user avec le MÊME UUID pour préserver
    // les FK historiques (taches.assigned_to, affectations.user_id, etc.), puis continuer
    // vers generateLink normalement.
    const { data: authUserData, error: getUserError } = await adminClient.auth.admin.getUserById(userId)

    if (getUserError || !authUserData?.user) {
      reqLogger.warn(
        { userId, email, correlationId },
        'Reinvite: auth user missing, recreating with same UUID',
      )
      const { error: createError } = await adminClient.auth.admin.createUser({
        id: userId,
        email,
        email_confirm: false,
        app_metadata: { organisation_id: organisationId, role: userRecord.role },
      })
      if (createError) {
        reqLogger.error(
          { error: createError.message, userId, email, correlationId },
          'Reinvite: failed to recreate missing auth user',
        )
        return NextResponse.json(
          { error: 'Impossible de reconstruire le compte technique. Contactez le support.' },
          { status: 500, headers: { 'X-Correlation-Id': correlationId } },
        )
      }
    }

    // type='invite' (vs 'magiclink') : 24h d'expiration au lieu de 1h, plus
    // tolérant aux Gmail/Outlook preview crawlers qui peuvent consommer le
    // token avant le clic réel de l'utilisateur (bug observé 2026-05-20).
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${appUrl}/auth/invite`,
      },
    })

    if (linkError || !linkData?.properties?.action_link) {
      reqLogger.error(
        { error: linkError?.message, userId, email, correlationId },
        'Reinvite: failed to generate magic link',
      )
      // Convention messages d'erreur (TECH_CONTEXT.md) — mapper les cas métier
      const errMsg = linkError?.message ?? ''
      if (errMsg.toLowerCase().includes('user not found')) {
        return NextResponse.json(
          { error: 'Utilisateur introuvable dans Supabase Auth. Supprimez puis recréez l\'invitation.' },
          { status: 404, headers: { 'X-Correlation-Id': correlationId } },
        )
      }
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const actionLink = linkData.properties.action_link

    // Envoyer l'email via Resend avec notre template branded
    // Les valeurs user (prenom, nom) passent par escapeHtml — l'URL pas besoin
    // (générée par Supabase, déjà safe).
    const html = renderEmail({
      bodyTemplate: 'invitation-renvoi',
      title: 'Activez votre compte ClawBTP',
      preheader: 'Vous avez ete invite(e) a rejoindre ClawBTP',
      vars: {
        PRENOM: escapeHtml(userRecord.prenom),
        NOM: escapeHtml(userRecord.nom),
        ACTION_URL: actionLink,
      },
    })

    try {
      await sendEmail({
        to: email,
        subject: 'Activez votre compte ClawBTP',
        html,
        tag: 'reinvite',
      })
    } catch (emailErr) {
      // Convention messages d'erreur (TECH_CONTEXT.md) — déléguer au helper DRY
      // mapEmailErrorToResponse (lib/notifications/email-errors.ts) qui mappe les
      // codes EmailSendError vers les codes HTTP + messages UX appropriés.
      reqLogger.error(
        {
          error: emailErr instanceof Error ? emailErr.message : String(emailErr),
          userId,
          email,
          correlationId,
        },
        'Reinvite: failed to send email via Resend',
      )
      return mapEmailErrorToResponse(emailErr, correlationId)
    }

    // 9. Remettre invitation_status à 'pending' après renvoi réussi
    const { error: updateError } = await adminClient
      .from('users')
      .update({ invitation_status: 'pending' })
      .eq('id', userId)
      .eq('organisation_id', organisationId)

    if (updateError) {
      reqLogger.error(
        { error: updateError.message, userId, correlationId },
        'Reinvite: invitation sent but failed to update status to pending',
      )
      // Invitation envoyée mais statut non mis à jour — état incohérent loggé
      // Ne pas bloquer : l'invitation est partie
    }

    reqLogger.info(
      { userId, email, organisationId, correlationId },
      'Invitation resent successfully',
    )

    return NextResponse.json(
      {
        data: {
          user_id: userId,
          invitation_status: 'pending',
          message: 'Invitation renvoyée.',
        },
      },
      { status: 200, headers: { 'X-Correlation-Id': correlationId } },
    )
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in POST /api/users/[id]/reinvite',
    )
    return toApiResponse(error, correlationId)
  }
}
