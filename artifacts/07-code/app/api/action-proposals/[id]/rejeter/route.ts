// app/api/action-proposals/[id]/rejeter/route.ts
// PATCH /api/action-proposals/[id]/rejeter — Rejeter une proposition du bot
//
// Implements: US-077 (rejet conducteur)
// RBAC : admin + conducteur UNIQUEMENT (ouvrier → 403)
// Workflow : pending → rejete
// D-8-14 : chantier_id/organisation_id depuis la row, jamais du body
// Pas d'exécution d'action (D-8-13 — jamais ici)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'
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

// ============================================================
// PATCH /api/action-proposals/[id]/rejeter
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: proposalId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'PATCH /api/action-proposals/[id]/rejeter',
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
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // 3. Récupérer la proposition (D-8-14 : organisation_id depuis la row)
    const { data: proposal, error: proposalError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .select('id, organisation_id, chantier_id, statut')
      .eq('id', proposalId)
      .maybeSingle() as unknown as {
        data: Pick<ActionProposal, 'id' | 'organisation_id' | 'chantier_id' | 'statut'> | null
        error: { message: string } | null
      }

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
    }

    // D-8-14 : vérifier appartenance organisation
    if (proposal.organisation_id !== auth.organisationId) {
      return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
    }

    // 4. Vérifier accès conducteur
    if (auth.role === 'conducteur') {
      const { data: chantierRow } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
        .from('chantiers')
        .select('id, created_by')
        .eq('id', proposal.chantier_id)
        .eq('organisation_id', auth.organisationId)
        .maybeSingle() as unknown as {
          data: { id: string; created_by: string } | null
          error: unknown
        }

      if (!chantierRow) {
        return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
      }

      if (chantierRow.created_by !== auth.userId) {
        const today = new Date().toISOString().split('T')[0]
        const { data: aff } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
          .from('affectations')
          .select('id')
          .eq('user_id', auth.userId)
          .eq('chantier_id', proposal.chantier_id)
          .eq('organisation_id', auth.organisationId)
          .or(`date_fin.is.null,date_fin.gte.${today}`)
          .limit(1) as unknown as { data: Array<{ id: string }> | null; error: unknown }

        if (!aff || aff.length === 0) {
          return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
        }
      }
    }

    // 5. Vérifier statut pending
    if (proposal.statut !== 'pending') {
      return NextResponse.json(
        { error: `Impossible de rejeter une proposition en statut '${proposal.statut}'.` },
        { status: 409 },
      )
    }

    // 6. UPDATE statut → rejete
    const { data: updated, error: updateError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .update({ statut: 'rejete' })
      .eq('id', proposalId)
      .select('id, organisation_id, chantier_id, message_id, type, payload, statut, valide_par, valide_at, erreur_execution, ressource_id, ressource_type, created_at')
      .single() as unknown as {
        data: ActionProposal | null
        error: { message: string } | null
      }

    if (updateError || !updated) {
      reqLogger.error({ error: updateError?.message }, 'PATCH rejeter: erreur UPDATE')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    reqLogger.info({ proposalId, userId: auth.userId }, 'PATCH rejeter: proposition rejetée')
    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'PATCH rejeter: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
