// app/api/chantiers/[id]/chat/messages/route.ts
// GET  /api/chantiers/[id]/chat/messages — historique messages (cursor-based, limit max 50)
// POST /api/chantiers/[id]/chat/messages — envoyer un message
//
// Implements: US-066 (POST message), US-069 (GET historique)
// US-066 : type TOUJOURS forcé 'user' côté handler (D-8-03 BINDING)
// US-066 : fire-and-forget pipeline → POST retourne 201 IMMÉDIATEMENT (D-8-10 BINDING)
//
// D-8-02 BINDING : Dual-path auth
//   JWT (admin/conducteur) → headers x-user-id/x-user-role/x-organisation-id (middleware)
//   Cookie ouvrier_session (ouvrier) → getOuvrierSession()
//   Priorité JWT si les deux sont présents
//
// RBAC :
//   Ouvrier : accès UNIQUEMENT aux chantiers auxquels il est affecté (404 cross-org/non-affecté)
//   Conducteur : ses chantiers (via affectation)
//   Admin : tous les chantiers de son organisation
//
// RLS : messages table — WITH CHECK(false) sur INSERT/UPDATE
//   Toutes les écritures via adminClient (bypass RLS). Lectures via createClient() (RLS SELECT).
//
// D-8-06 BINDING : pagination cursor-based, limit max 50 enforced server-side
// RG-CHAT-005 : message 1-4000 chars (enforced par Zod PostMessageBodySchema)
// V-8-07 : POST body type != 'user' → 400 (enforced par Zod literal('user'))
// D-8-14 : chantier_id/organisation_id TOUJOURS depuis row DB, jamais payload
// EXI-8-06 : contenu stocké brut — rendu JSX pur côté UI (pas d'HTML dans les données)

// D-3-010 : Node runtime obligatoire (session ouvrier Postgres)
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'
import { PostMessageBodySchema, GetMessagesQuerySchema } from '@/lib/validation/chat'
import { lancerPipelineBot } from '@/lib/chat/pipeline-bot'
import type { UserRole } from '@/types/database'
import type { MessageChat } from '@/types/chat'

// ============================================================
// Auth dual-path helper
// D-8-02 BINDING : JWT prioritaire si les deux présents
// ============================================================

type AuthResult =
  | {
      type: 'jwt'
      userId: string
      role: 'admin' | 'conducteur'
      organisationId: string
    }
  | {
      type: 'ouvrier'
      userId: string
      role: 'ouvrier'
      organisationId: string
      ouvrierSession: NonNullable<Awaited<ReturnType<typeof getOuvrierSession>>>
    }
  | null

async function resolveAuth(request: NextRequest): Promise<AuthResult> {
  // JWT (admin/conducteur) — priorité (D-8-02)
  const xUserId = request.headers.get('x-user-id')
  const xRole = request.headers.get('x-user-role') as UserRole | null
  const xOrgId = request.headers.get('x-organisation-id')

  if (xUserId && xRole && xOrgId && (xRole === 'admin' || xRole === 'conducteur')) {
    return {
      type: 'jwt',
      userId: xUserId,
      role: xRole,
      organisationId: xOrgId,
    }
  }

  // Cookie ouvrier_session
  const session = await getOuvrierSession(request)
  if (session) {
    return {
      type: 'ouvrier',
      userId: session.user_id,
      role: 'ouvrier',
      organisationId: session.organisation_id,
      ouvrierSession: session,
    }
  }

  return null
}

// ============================================================
// RBAC helper — vérifier l'accès au chantier
// Ouvrier : doit être affecté (pas juste dans l'org)
// Admin : tous les chantiers de son org
// Conducteur : ses chantiers (affecté ou créateur)
//
// Retourne un discriminant pour distinguer :
//   'ok'       — accès autorisé
//   'archived' — chantier archivé + utilisateur légitime → 403 (RG-CHAT-007)
//   'not_found' — chantier inexistant, cross-org, ou non-membre → 404 (S-8 threat model)
// ============================================================

type ChantierAccessResult = 'ok' | 'archived' | 'not_found'

async function assertChantierAccess(
  auth: NonNullable<AuthResult>,
  chantierId: string,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<ChantierAccessResult> {
  // Vérifier que le chantier appartient bien à l'org (protection cross-org IDOR)
  const { data: chantierRow, error: chantierError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
    .from('chantiers')
    .select('id, organisation_id, statut')
    .eq('id', chantierId)
    .eq('organisation_id', auth.organisationId)
    .maybeSingle() as unknown as {
      data: { id: string; organisation_id: string; statut: string } | null
      error: { message: string } | null
    }

  if (chantierError || !chantierRow) {
    return 'not_found'
  }

  if (auth.role === 'admin') {
    // Admin peut accéder à tous les chantiers de son org
    // RG-CHAT-007 : chantier archivé → 403 même pour admin (chat fermé)
    if (chantierRow.statut === 'archive') {
      return 'archived'
    }
    return 'ok'
  }

  if (auth.role === 'ouvrier') {
    // Ouvrier : doit être affecté à CE chantier
    // RG-CHAT-007 : chantier archivé → 403 même si affecté (chat fermé)
    if (chantierRow.statut === 'archive') {
      return 'archived'
    }
    const today = new Date().toISOString().split('T')[0]
    const { data: affectation, error: affError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
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

    return (!affError && !!affectation && affectation.length > 0) ? 'ok' : 'not_found'
  }

  if (auth.role === 'conducteur') {
    // Conducteur : affecté OU créateur
    // RG-CHAT-007 : chantier archivé → 403 même si conducteur (chat fermé)
    if (chantierRow.statut === 'archive') {
      return 'archived'
    }
    const today = new Date().toISOString().split('T')[0]
    const { data: affectation, error: affError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
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

    if (!affError && affectation && affectation.length > 0) {
      return 'ok'
    }

    // Vérifier s'il est créateur du chantier
    const { data: created, error: createdError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chantiers')
      .select('id')
      .eq('id', chantierId)
      .eq('organisation_id', auth.organisationId)
      .eq('created_by', auth.userId)
      .maybeSingle() as unknown as {
        data: { id: string } | null
        error: { message: string } | null
      }

    return (!createdError && !!created) ? 'ok' : 'not_found'
  }

  return 'not_found'
}

// ============================================================
// GET /api/chantiers/[id]/chat/messages
// Historique, cursor-based (D-8-06), limit max 50
// Retourne les messages NON supprimés (deleted_at IS NULL)
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chantierId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/chantiers/[id]/chat/messages',
    chantierId,
  })

  try {
    // 1. Auth dual-path
    const auth = await resolveAuth(request)
    if (!auth) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // 2. RBAC : vérifier accès au chantier
    // GET : 404 dans tous les cas d'échec (pas de distinction archived — lecture historique permise)
    const accessResult = await assertChantierAccess(auth, chantierId, adminClient)
    if (accessResult !== 'ok') {
      // 404 pour ne pas confirmer l'existence du chantier (cross-org)
      return NextResponse.json({ error: 'Chantier introuvable.' }, { status: 404 })
    }

    // 3. Valider query params
    const url = new URL(request.url)
    const rawQuery = {
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    }

    const parsed = GetMessagesQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { cursor, limit } = parsed.data

    // 4. Récupérer le chat du chantier
    const { data: chatRow, error: chatError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chats')
      .select('id')
      .eq('chantier_id', chantierId)
      .eq('organisation_id', auth.organisationId)
      .maybeSingle() as unknown as {
        data: { id: string } | null
        error: { message: string } | null
      }

    if (chatError || !chatRow) {
      // Chat non encore créé (chantier pré-Sprint 8) — retourner liste vide
      return NextResponse.json({ messages: [], has_more: false }, { status: 200 })
    }

    // 5. Requête messages avec cursor pagination (D-8-06)
    // Filtre : deleted_at IS NULL (messages non supprimés)
    // Ordre : created_at ASC (chronologique)
    // cursor = created_at du message le plus ancien déjà chargé (scroll vers le haut)
    type MessageRow = {
      id: string
      chat_id: string
      chantier_id: string
      auteur_id: string | null
      auteur_nom: string | null
      auteur_role: string | null
      type: string
      contenu: string
      deleted_at: string | null
      action_proposal_id: string | null
      created_at: string
    }

    // Utiliser createClient() pour la lecture (RLS SELECT authenticated)
    const supabase = await createClient()

    type MessagesQuery = {
      data: MessageRow[] | null
      error: { message: string } | null
    }

    let messagesQuery = (supabase as unknown as ReturnType<typeof createAdminClient>)
      .from('messages')
      .select(
        'id, chat_id, chantier_id, auteur_id, auteur_nom, auteur_role, type, contenu, deleted_at, action_proposal_id, created_at',
      )
      .eq('chat_id', chatRow.id)
      .eq('chantier_id', chantierId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit + 1) // +1 pour détecter has_more

    if (cursor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messagesQuery = (messagesQuery as any).gt('created_at', cursor)
    }

    const { data: messagesRaw, error: messagesError } = await (messagesQuery as unknown as MessagesQuery)

    if (messagesError) {
      reqLogger.error({ error: messagesError.message }, 'GET messages: erreur DB')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    const rows = messagesRaw ?? []
    const has_more = rows.length > limit
    const messages: MessageChat[] = rows.slice(0, limit).map((m) => ({
      id: m.id,
      chat_id: m.chat_id,
      chantier_id: m.chantier_id,
      auteur_id: m.auteur_id,
      auteur_nom: m.auteur_nom,
      auteur_role: m.auteur_role as MessageChat['auteur_role'],
      type: m.type as MessageChat['type'],
      contenu: m.contenu,
      deleted_at: m.deleted_at,
      action_proposal_id: m.action_proposal_id,
      created_at: m.created_at,
    }))

    reqLogger.debug({ count: messages.length, has_more }, 'GET messages OK')
    return NextResponse.json({ messages, has_more }, { status: 200 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'GET messages: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}

// ============================================================
// POST /api/chantiers/[id]/chat/messages
// Envoyer un message — 201 immédiat + fire-and-forget pipeline
// D-8-03 BINDING : type TOUJOURS forcé 'user' (jamais 'bot'/'system' depuis client)
// D-8-10 BINDING : pipeline lancé void sans await → réponse 201 immédiate
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chantierId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'POST /api/chantiers/[id]/chat/messages',
    chantierId,
  })

  try {
    // 1. Auth dual-path
    const auth = await resolveAuth(request)
    if (!auth) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // 2. RBAC : vérifier accès au chantier
    // RG-CHAT-007 : chantier archivé + utilisateur légitime → 403 (chat fermé)
    // S-8 threat model : chantier inexistant/cross-org → 404 (ne confirme pas l'existence)
    const accessResult = await assertChantierAccess(auth, chantierId, adminClient)
    if (accessResult === 'archived') {
      return NextResponse.json(
        { error: 'Chat fermé — ce chantier est archivé.' },
        { status: 403 },
      )
    }
    if (accessResult === 'not_found') {
      return NextResponse.json({ error: 'Chantier introuvable.' }, { status: 404 })
    }

    // 3. Valider body (Zod)
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
    }

    const parsed = PostMessageBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      // V-8-07 : type != 'user' → 400 (couvert par z.literal('user').optional())
      return NextResponse.json(
        { error: 'Requête invalide.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { contenu } = parsed.data

    // 4. Récupérer le chat
    const { data: chatRow, error: chatError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chats')
      .select('id, organisation_id')
      .eq('chantier_id', chantierId)
      .eq('organisation_id', auth.organisationId)
      .maybeSingle() as unknown as {
        data: { id: string; organisation_id: string } | null
        error: { message: string } | null
      }

    if (chatError || !chatRow) {
      reqLogger.warn({ chantierId }, 'POST messages: chat introuvable pour ce chantier')
      return NextResponse.json({ error: 'Chat introuvable pour ce chantier.' }, { status: 404 })
    }

    // 5. Résoudre le nom d'affichage de l'auteur
    const { data: userRow } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('users')
      .select('prenom, nom')
      .eq('id', auth.userId)
      .maybeSingle() as unknown as {
        data: { prenom: string; nom: string } | null
        error: unknown
      }

    const auteurNom = userRow
      ? `${userRow.prenom} ${userRow.nom}`.trim()
      : 'Utilisateur'

    // 6. Insérer le message via adminClient (RLS WITH CHECK(false) sur INSERT)
    // D-8-03 BINDING : type TOUJOURS 'user' — jamais 'bot' ou 'system' depuis client
    const { data: msgRow, error: insertError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('messages')
      .insert({
        chat_id: chatRow.id,
        chantier_id: chantierId,
        auteur_id: auth.userId,
        auteur_nom: auteurNom,
        auteur_role: auth.role,
        type: 'user', // BINDING D-8-03 : forcé 'user', jamais depuis parsed.data.type
        contenu,
        deleted_at: null,
        action_proposal_id: null,
      })
      .select('id, chat_id, chantier_id, auteur_id, auteur_nom, auteur_role, type, contenu, deleted_at, action_proposal_id, created_at')
      .single() as unknown as {
        data: MessageChat | null
        error: { message: string } | null
      }

    if (insertError || !msgRow) {
      reqLogger.error({ error: insertError?.message, chantierId }, 'POST messages: erreur INSERT')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // 7. Fire-and-forget pipeline bot (D-8-10 BINDING — void sans await)
    // JAMAIS await — la réponse 201 doit être retournée immédiatement
    const pipelineParams = {
      messageId: msgRow.id,
      contenu,
      chantierId,
      chatId: chatRow.id,
      organisationId: auth.organisationId,
      roleAppelant: auth.role,
      ...(auth.role === 'ouvrier' ? { ouvrierUserId: auth.userId } : {}),
    }
    void lancerPipelineBot(pipelineParams)

    reqLogger.info(
      { messageId: msgRow.id, role: auth.role },
      'POST messages: message inséré + pipeline lancé',
    )

    // 8. Réponse 201 immédiate (D-8-10)
    return NextResponse.json(msgRow, { status: 201 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'POST messages: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
