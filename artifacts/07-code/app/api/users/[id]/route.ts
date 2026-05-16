import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toApiResponse, ForbiddenError, NotFoundError } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// GET /api/users/[id] — Détail d'un membre (admin uniquement)
//
// T-01 : organisation_id extrait depuis les headers middleware (jamais depuis params/body)
// Ownership check : users.organisation_id DOIT correspondre au JWT organisation_id
// qr_token toujours exclu de la réponse (S-01)
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
