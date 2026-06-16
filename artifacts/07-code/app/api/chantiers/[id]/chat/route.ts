// app/api/chantiers/[id]/chat/route.ts
// GET /api/chantiers/[id]/chat — Métadonnées du chat (messages_count, chat_id)
//
// Implements: US-066 (accès chat), US-069 (polling 30s côté client)
// D-8-02 BINDING : dual-path auth (JWT admin/conducteur + cookie ouvrier)
// RBAC : ouvrier accès uniquement ses chantiers affectés (404 cross-org)
// RLS : lecture via createClient() (SELECT authenticated RLS)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// Auth dual-path (identique à messages/route.ts)
// D-8-02 BINDING
// ============================================================

type ChatAuthResult = {
  userId: string
  role: 'admin' | 'conducteur' | 'ouvrier'
  organisationId: string
} | null

async function resolveAuth(request: NextRequest): Promise<ChatAuthResult> {
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
// GET /api/chantiers/[id]/chat
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chantierId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/chantiers/[id]/chat',
    chantierId,
  })

  try {
    const auth = await resolveAuth(request)
    if (!auth) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Vérifier que le chantier appartient à l'organisation (protection cross-org)
    const { data: chantierRow, error: chantierError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chantiers')
      .select('id, organisation_id')
      .eq('id', chantierId)
      .eq('organisation_id', auth.organisationId)
      .maybeSingle() as unknown as {
        data: { id: string; organisation_id: string } | null
        error: { message: string } | null
      }

    if (chantierError || !chantierRow) {
      return NextResponse.json({ error: 'Chantier introuvable.' }, { status: 404 })
    }

    // Ouvrier : vérifier affectation
    if (auth.role === 'ouvrier') {
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

      if (affErr || !aff || aff.length === 0) {
        return NextResponse.json({ error: 'Chantier introuvable.' }, { status: 404 })
      }
    }

    // Récupérer le chat via createClient() (RLS SELECT)
    const supabase = await createClient()
    const { data: chatRow, error: chatError } = await (supabase as unknown as ReturnType<typeof createAdminClient>)
      .from('chats')
      .select('id, chantier_id, organisation_id, messages_count, created_at')
      .eq('chantier_id', chantierId)
      .eq('organisation_id', auth.organisationId)
      .maybeSingle() as unknown as {
        data: {
          id: string
          chantier_id: string
          organisation_id: string
          messages_count: number
          created_at: string
        } | null
        error: { message: string } | null
      }

    if (chatError) {
      reqLogger.error({ error: chatError.message }, 'GET chat: erreur DB')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    if (!chatRow) {
      // Chat non encore créé (chantier pré-Sprint 8)
      return NextResponse.json({ chat: null }, { status: 200 })
    }

    reqLogger.debug({ chatId: chatRow.id }, 'GET chat OK')
    return NextResponse.json({ chat: chatRow }, { status: 200 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'GET chat: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
