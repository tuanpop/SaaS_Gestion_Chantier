// app/api/action-proposals/[id]/payload/route.ts
// PATCH /api/action-proposals/[id]/payload — Modifier le payload avant validation
//
// Implements: US-072 (édition payload conducteur)
// RBAC : admin + conducteur uniquement (ouvrier → 403)
// Workflow : statut DOIT être 'pending' — sinon 409 Conflict
// D-8-14 BINDING : chantier_id/organisation_id depuis la row action_proposals, jamais du body
// EXI-Y-K8-06 : validatePayloadByType() avec .strict() rejette chantier_id/organisation_id

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'
import { validatePayloadByType } from '@/lib/validation/chat'
import type { UserRole } from '@/types/database'
import type { ActionProposal } from '@/types/chat'

// Auth dual-path helper
type AuthResult = {
  userId: string
  role: 'admin' | 'conducteur' | 'ouvrier'
  organisationId: string
} | null

async function resolveAuth(request: NextRequest): Promise<AuthResult> {
  const xUserId = request.headers.get('x-user-id')
  const xRole = request.headers.get('x-user-role') as UserRole | null
  const xOrgId = request.headers.get('x-organisation-id')

  if (xUserId && xRole && xOrgId && (xRole === 'admin' || xRole === 'conducteur')) {
    return { userId: xUserId, role: xRole, organisationId: xOrgId }
  }

  const session = await getOuvrierSession(request)
  if (session) {
    return {
      userId: session.user_id,
      role: 'ouvrier',
      organisationId: session.organisation_id,
    }
  }

  return null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: proposalId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'PATCH /api/action-proposals/[id]/payload',
    proposalId,
  })

  try {
    // 1. Auth
    const auth = await resolveAuth(request)
    if (!auth) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Ouvrier → 403
    if (auth.role === 'ouvrier') {
      return NextResponse.json(
        { error: 'Accès refusé.' },
        { status: 403 },
      )
    }

    // 3. Valider body
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
    }

    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json({ error: 'Payload manquant.' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // 4. Récupérer la proposition (D-8-14 : organisation_id depuis la row)
    const { data: proposal, error: proposalError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .select('id, organisation_id, chantier_id, type, statut, payload')
      .eq('id', proposalId)
      .maybeSingle() as unknown as {
        data: Pick<ActionProposal, 'id' | 'organisation_id' | 'chantier_id' | 'type' | 'statut' | 'payload'> | null
        error: { message: string } | null
      }

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
    }

    // D-8-14 : vérifier que la proposition appartient à l'organisation de l'utilisateur
    if (proposal.organisation_id !== auth.organisationId) {
      return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
    }

    // 5. Vérifier statut pending
    if (proposal.statut !== 'pending') {
      return NextResponse.json(
        { error: `Impossible de modifier une proposition en statut '${proposal.statut}'.` },
        { status: 409 },
      )
    }

    // 6. Valider nouveau payload (EXI-Y-K8-06 : .strict() rejette chantier_id/organisation_id)
    const validation = validatePayloadByType(proposal.type, rawBody)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Payload invalide.',
          details: 'error' in validation ? validation.error?.flatten() : undefined,
        },
        { status: 400 },
      )
    }

    // 7. UPDATE payload (organisation_id/chantier_id préservés depuis la row — D-8-14)
    const { data: updated, error: updateError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .update({
        payload: validation.data as unknown as import('@/types/database').Json,
      })
      .eq('id', proposalId)
      .select('id, organisation_id, chantier_id, message_id, type, payload, statut, valide_par, valide_at, erreur_execution, ressource_id, ressource_type, created_at')
      .single() as unknown as {
        data: ActionProposal | null
        error: { message: string } | null
      }

    if (updateError || !updated) {
      reqLogger.error({ error: updateError?.message }, 'PATCH payload: erreur UPDATE')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    reqLogger.info(
      { proposalId, type: proposal.type, userId: auth.userId },
      'PATCH payload: payload mis à jour',
    )

    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'PATCH payload: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
