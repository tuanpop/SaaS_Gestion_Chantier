// app/api/chantiers/[id]/action-proposals/route.ts
// GET /api/chantiers/[id]/action-proposals — Liste des propositions du bot
//
// Implements: US-071 (liste propositions), US-073 (file validation conducteur)
// RBAC :
//   Admin : accès complet
//   Conducteur : ses chantiers uniquement
//   Ouvrier : 403 BINDING (US-074 / RBAC-OUVRIER-003)
//     Ouvrier ne peut pas voir la file de propositions — même pour son chantier
//
// D-8-06 BINDING : pagination cursor-based, limit max 50
// D-8-14 : chantier_id/organisation_id depuis DB, jamais payload
// RLS : action_proposals WITH CHECK(false) → lecture via createClient() (SELECT RLS)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'
import { GetProposalsQuerySchema } from '@/lib/validation/chat'
import type { UserRole } from '@/types/database'
import type { ActionProposal } from '@/types/chat'

// ============================================================
// Auth dual-path (JWT prioritaire)
// ============================================================

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
// GET /api/chantiers/[id]/action-proposals
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chantierId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/chantiers/[id]/action-proposals',
    chantierId,
  })

  try {
    // 1. Auth dual-path
    const auth = await resolveAuth(request)
    if (!auth) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Ouvrier → 403 BINDING (US-074 / RBAC-OUVRIER-003)
    if (auth.role === 'ouvrier') {
      return NextResponse.json(
        { error: 'Accès refusé. Les propositions sont réservées aux conducteurs et administrateurs.' },
        { status: 403 },
      )
    }

    const adminClient = createAdminClient()

    // 3. Vérifier accès chantier (protection cross-org)
    const { data: chantierRow, error: chantierError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chantiers')
      .select('id, organisation_id, created_by')
      .eq('id', chantierId)
      .eq('organisation_id', auth.organisationId)
      .maybeSingle() as unknown as {
        data: { id: string; organisation_id: string; created_by: string } | null
        error: { message: string } | null
      }

    if (chantierError || !chantierRow) {
      return NextResponse.json({ error: 'Chantier introuvable.' }, { status: 404 })
    }

    // 4. Conducteur : vérifier affectation ou création
    if (auth.role === 'conducteur') {
      const today = new Date().toISOString().split('T')[0]
      const { data: aff, error: affErr } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
        .from('affectations')
        .select('id')
        .eq('user_id', auth.userId)
        .eq('chantier_id', chantierId)
        .eq('organisation_id', auth.organisationId)
        .or(`date_fin.is.null,date_fin.gte.${today}`)
        .limit(1) as unknown as {
          data: Array<{ id: string }> | null
          error: { message: string } | null
        }

      const isAffecter = !affErr && aff && aff.length > 0
      const isCreateur = chantierRow.created_by === auth.userId

      if (!isAffecter && !isCreateur) {
        return NextResponse.json({ error: 'Chantier introuvable.' }, { status: 404 })
      }
    }

    // 5. Valider query params
    const url = new URL(request.url)
    const rawQuery = {
      statut: url.searchParams.get('statut') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    }

    const parsed = GetProposalsQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { statut, limit, cursor } = parsed.data

    // 6. Récupérer les propositions via createClient() (RLS SELECT)
    const supabase = await createClient()

    type ProposalRow = {
      id: string
      organisation_id: string
      chantier_id: string
      message_id: string
      type: string
      payload: unknown
      statut: string
      valide_par: string | null
      valide_at: string | null
      erreur_execution: string | null
      ressource_id: string | null
      ressource_type: string | null
      created_at: string
    }

    let query = (supabase as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .select(
        'id, organisation_id, chantier_id, message_id, type, payload, statut, valide_par, valide_at, erreur_execution, ressource_id, ressource_type, created_at',
      )
      .eq('chantier_id', chantierId)
      .eq('organisation_id', auth.organisationId)
      .order('created_at', { ascending: false })
      .limit(limit + 1) // +1 pour has_more

    if (statut) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = (query as any).eq('statut', statut)
    }

    if (cursor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = (query as any).lt('created_at', cursor)
    }

    const { data: proposalsRaw, error: proposalsError } = await (query as unknown as {
      data: ProposalRow[] | null
      error: { message: string } | null
    })

    if (proposalsError) {
      reqLogger.error({ error: proposalsError.message }, 'GET action-proposals: erreur DB')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    const rows = proposalsRaw ?? []
    const has_more = rows.length > limit
    const proposals: ActionProposal[] = rows.slice(0, limit).map((p) => ({
      id: p.id,
      organisation_id: p.organisation_id,
      chantier_id: p.chantier_id,
      message_id: p.message_id,
      type: p.type as ActionProposal['type'],
      payload: p.payload as ActionProposal['payload'],
      statut: p.statut as ActionProposal['statut'],
      valide_par: p.valide_par,
      valide_at: p.valide_at,
      erreur_execution: p.erreur_execution,
      ressource_id: p.ressource_id,
      ressource_type: p.ressource_type as ActionProposal['ressource_type'],
      created_at: p.created_at,
    }))

    reqLogger.debug({ count: proposals.length, has_more, statut }, 'GET action-proposals OK')
    return NextResponse.json({ proposals, has_more }, { status: 200 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'GET action-proposals: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
