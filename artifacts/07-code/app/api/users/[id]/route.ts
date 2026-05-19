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
// GET /api/users/[id] — Détail d'un membre (admin uniquement)
// DELETE /api/users/[id] — Soft delete d'un membre (admin uniquement)
//
// T-01 : organisation_id extrait depuis les headers middleware (jamais depuis params/body)
// Ownership check : users.organisation_id DOIT correspondre au JWT organisation_id
// qr_token toujours exclu de la réponse (S-01)
// D-012 : assertTrialActive() sur DELETE (mutation)
// Soft delete : deleted_at = NOW(), qr_token = NULL (migration 003_users_soft_delete.sql)
// Hard delete Supabase Auth : adminClient.auth.admin.deleteUser() si has_supabase_auth=true
// ============================================================

// Validation du paramètre [id] — doit être un UUID valide
const IdParamSchema = z.string().uuid('Le paramètre id doit être un UUID valide.')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const correlationId = headerStore.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  // Suppression de la variable inutilisée
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
      reqLogger.warn({ role, correlationId }, 'Non-admin tried to access GET /api/users/[id]')
      throw new ForbiddenError()
    }

    // 3. Valider le paramètre [id] — params est une Promise en Next.js 15
    const resolvedParams = await params
    const idParsed = IdParamSchema.safeParse(resolvedParams.id)
    if (!idParsed.success) {
      return NextResponse.json(
        { error: 'Identifiant invalide.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const userId = idParsed.data

    // 4. Requête DB avec ownership check (T-01)
    // Filtre double : id ET organisation_id => garantit qu'un admin ne peut pas
    // accéder aux users d'une autre organisation même s'il connaît l'UUID
    // qr_token exclu du SELECT (S-01 — jamais exposé)
    const supabase = await createClient()
    const { data: user, error: dbError } = await supabase
      .from('users')
      .select(
        'id, organisation_id, role, nom, prenom, telephone, email, has_supabase_auth, invitation_status, avatar_url, created_at',
      )
      .eq('id', userId)
      .eq('organisation_id', organisationId)
      .single()

    if (dbError || !user) {
      reqLogger.warn(
        { userId, organisationId, error: dbError?.message, correlationId },
        'User not found or not in organisation',
      )
      // NotFoundError générique — ne pas révéler si l'user existe dans une autre org (T-01)
      throw new NotFoundError('user')
    }

    reqLogger.info(
      { userId, organisationId, correlationId },
      'User detail fetched',
    )

    return NextResponse.json(
      { data: user },
      { status: 200, headers: { 'X-Correlation-Id': correlationId } },
    )
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in GET /api/users/[id]',
    )
    return toApiResponse(error, correlationId)
  }
}

// ============================================================
// DELETE /api/users/[id] — Soft delete d'un membre (admin uniquement)
// ============================================================

export async function DELETE(
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
    const callerUserId = headerStore.get('x-user-id')

    if (!organisationId || !role || !callerUserId) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 2. Vérification rôle admin
    if (role !== 'admin') {
      reqLogger.warn(
        { role, correlationId },
        'Non-admin tried to DELETE /api/users/[id]',
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

    // 5. Bloquer l'auto-suppression
    if (userId === callerUserId) {
      reqLogger.warn(
        { userId, callerUserId, correlationId },
        'DELETE /api/users/[id]: admin tried to delete themselves',
      )
      return NextResponse.json(
        { error: 'Vous ne pouvez pas supprimer votre propre compte.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 6. Récupérer le user avec ownership check (T-01)
    // Cast explicite nécessaire — deleted_at ajouté par migration 003, absent du type généré
    const { data: userRecord, error: dbError } = await supabase
      .from('users')
      .select('id, organisation_id, has_supabase_auth')
      .eq('id', userId)
      .eq('organisation_id', organisationId)
      .is('deleted_at', null)
      .single() as {
        data: Pick<Tables<'users'>, 'id' | 'organisation_id' | 'has_supabase_auth'> | null
        error: { message: string } | null
      }

    if (dbError || !userRecord) {
      reqLogger.warn(
        { userId, organisationId, error: dbError?.message, correlationId },
        'DELETE users/[id]: user not found or not in organisation',
      )
      throw new NotFoundError('user')
    }

    // 7. Si le user a un compte Supabase Auth, le supprimer pour bloquer toute connexion future
    // DANGER: bypass RLS intentionnel — adminClient requis pour auth.admin.deleteUser
    const adminClient = createAdminClient()

    if (userRecord.has_supabase_auth) {
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId)
      if (authDeleteError) {
        reqLogger.error(
          { error: authDeleteError.message, userId, correlationId },
          'DELETE users/[id]: failed to delete Supabase Auth user',
        )
        return NextResponse.json(
          { error: 'Une erreur interne est survenue.' },
          { status: 500, headers: { 'X-Correlation-Id': correlationId } },
        )
      }
    }

    // 8. Soft delete : deleted_at = NOW(), qr_token = NULL
    // Cast vers any sur l'update car deleted_at n'est pas encore dans le type généré (migration 003)
    const { error: updateError } = await adminClient
      .from('users')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ deleted_at: new Date().toISOString(), qr_token: null } as any)
      .eq('id', userId)
      .eq('organisation_id', organisationId)

    if (updateError) {
      reqLogger.error(
        { error: updateError.message, userId, organisationId, correlationId },
        'DELETE users/[id]: failed to soft-delete user record',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    reqLogger.info(
      { userId, organisationId, correlationId },
      'User soft-deleted successfully',
    )

    return new NextResponse(null, {
      status: 204,
      headers: { 'X-Correlation-Id': correlationId },
    })
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in DELETE /api/users/[id]',
    )
    return toApiResponse(error, correlationId)
  }
}
