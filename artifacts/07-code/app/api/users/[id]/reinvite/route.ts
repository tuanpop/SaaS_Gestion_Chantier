import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { toApiResponse, ForbiddenError, NotFoundError } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'
import type { UserRole, Tables } from '@/types/database'

// ============================================================
// POST /api/users/[id]/reinvite — Renvoi invitation expirée (admin uniquement)
//
// Préconditions :
//   - user.invitation_status = 'expired' (sinon HTTP 400)
//   - user.role = 'conducteur' (les ouvriers n'ont pas d'invitation)
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

    // 6. Vérifier que l'invitation est bien expirée (sinon 400)
    if (userRecord.invitation_status !== 'expired') {
      reqLogger.warn(
        { userId, invitationStatus: userRecord.invitation_status, correlationId },
        'Reinvite: invitation is not expired',
      )
      return NextResponse.json(
        {
          error: `Impossible de renvoyer l'invitation : statut actuel '${userRecord.invitation_status ?? 'null'}'. Seules les invitations expirées peuvent être renvoyées.`,
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

    // 8. Renvoyer l'invitation via adminClient (opération admin Supabase Auth)
    // DANGER: bypass RLS intentionnel — inviteUserByEmail opération admin
    const adminClient = createAdminClient()

    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          organisation_id: organisationId,
          role: userRecord.role,
        },
      },
    )

    if (inviteError) {
      reqLogger.error(
        { error: inviteError.message, userId, email, correlationId },
        'Reinvite: failed to send invitation via Supabase Auth',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
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
