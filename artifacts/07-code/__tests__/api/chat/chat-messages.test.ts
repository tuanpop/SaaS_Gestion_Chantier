/**
 * __tests__/api/chat/chat-messages.test.ts
 *
 * Tests GET + POST /api/chantiers/[id]/chat/messages
 *
 * D-8-10 BINDING : POST retourne 201 immédiat — void pipeline (pas d'await)
 * D-8-03 BINDING : type TOUJOURS forcé 'user' (V-8-07 : type != 'user' → 400)
 * D-8-02 BINDING : dual-path auth — JWT prioritaire, cookie ouvrier en fallback
 * D-8-06 BINDING : pagination cursor, limit max 50
 * RBAC : ouvrier affecté → accès OK, ouvrier non-affecté → 404
 *
 * Cas couverts :
 *   POST-1 : admin happy path → 201 + pipeline lancé void
 *   POST-2 : sans auth → 401
 *   POST-3 : body vide → 400
 *   POST-4 : body type='bot' → 400 (V-8-07 — z.literal('user') rejette 'bot')
 *   POST-5 : message > 4000 chars → 400
 *   POST-6 : chat absent (chantier pré-Sprint 8) → créé à la volée → 201
 *   GET-1 : admin → 200 + messages[]
 *   GET-2 : limit > 50 → 400 (D-8-06 enforced server-side)
 *   GET-3 : unauthenticated → 401
 *   RBAC-1 : ouvrier non-affecté → 404
 *   FIRE-1 : void pipeline — POST 201 même si pipeline serait lent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockAdminFrom, mockCreateClient, mockLogger, mockOuvrierSession, mockLancerPipelineBot } = vi.hoisted(() => {
  const mockAdminFrom = vi.fn()
  const mockClientFrom = vi.fn()
  return {
    mockAdminFrom,
    mockCreateClient: {
      from: mockClientFrom,
    },
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    mockOuvrierSession: vi.fn(),
    mockLancerPipelineBot: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/llm/register', () => ({}))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gt: vi.fn().mockResolvedValue({ data: [], error: null }),
  }) }),
}))
vi.mock('@/lib/ouvrier-session', () => ({ getOuvrierSession: mockOuvrierSession }))
vi.mock('@/lib/chat/pipeline-bot', () => ({ lancerPipelineBot: mockLancerPipelineBot }))

import { GET, POST } from '@/app/api/chantiers/[id]/chat/messages/route'
import { NextRequest } from 'next/server'

// ============================================================
// Helpers
// ============================================================

const ORG_ID = 'org-uuid-0000-0000-0000-000000000001'
const USER_ID = 'user-uuid-0000-0000-0000-000000000001'
const CHANTIER_ID = 'chantier-uuid-000-0000-000000000001'
const CHAT_ID = 'chat-uuid-0000-0000-0000-000000000001'
const MESSAGE_ID = 'msg-uuid-0000-0000-0000-000000000001'

function makeRequest(url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  if (body !== undefined) {
    return new NextRequest(url, { method, headers, body: JSON.stringify(body) })
  }
  return new NextRequest(url, { method, headers })
}

const adminHeaders = {
  'x-user-id': USER_ID,
  'x-user-role': 'admin',
  'x-organisation-id': ORG_ID,
}

// Mock adminClient pour les appels multi-table
function setupAdminMock(overrides: {
  chantierData?: unknown
  chatData?: unknown
  chatDataAfterCreate?: unknown
  userRow?: unknown
  insertData?: unknown
  affectationData?: unknown
  messagesData?: unknown[]
} = {}) {
  const {
    chantierData = { id: CHANTIER_ID, organisation_id: ORG_ID, statut: 'actif' },
    chatData = { id: CHAT_ID, organisation_id: ORG_ID },
    // Re-lecture après création paresseuse (get-or-create) — chantier pré-Sprint 8
    chatDataAfterCreate = { id: CHAT_ID, organisation_id: ORG_ID },
    // Lecture GET messages (via adminClient depuis le fix RLS ouvrier)
    messagesData = [],
    userRow = { prenom: 'Jean', nom: 'Dupont' },
    insertData = {
      id: MESSAGE_ID,
      chat_id: CHAT_ID,
      chantier_id: CHANTIER_ID,
      auteur_id: USER_ID,
      auteur_nom: 'Jean Dupont',
      auteur_role: 'admin',
      type: 'user',
      contenu: 'Test message',
      deleted_at: null,
      action_proposal_id: null,
      created_at: new Date().toISOString(),
    },
    affectationData = null,
  } = overrides

  let callIndex = 0
  let chatsSelectCall = 0
  mockAdminFrom.mockImplementation((tableName: string) => {
    if (tableName === 'chantiers') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: chantierData, error: null }),
            }),
          }),
        }),
      }
    }
    if (tableName === 'affectations') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: affectationData, error: null }),
        }),
      }
    }
    if (tableName === 'chats') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(() => {
                chatsSelectCall++
                // 1er appel = lookup initial ; appels suivants = re-lecture après création paresseuse
                const data = chatsSelectCall === 1 ? chatData : (chatData ?? chatDataAfterCreate)
                return Promise.resolve({ data, error: null })
              }),
            }),
          }),
        }),
        // get-or-create : upsert idempotent (onConflict chantier_id)
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }
    }
    if (tableName === 'users') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: userRow, error: null }),
          }),
        }),
      }
    }
    if (tableName === 'messages') {
      // POST : .insert().select().single()
      const singleFn = vi.fn().mockResolvedValue({ data: insertData, error: null })
      const insertSelectFn = vi.fn().mockReturnValue({ single: singleFn })
      const insertFn = vi.fn().mockReturnValue({ select: insertSelectFn })

      // GET (via adminClient depuis fix RLS ouvrier) :
      // .select().eq().eq().is().order().limit() [thenable] + .gt() (cursor)
      const readResult = { data: messagesData, error: null }
      const limitObj = {
        gt: vi.fn().mockResolvedValue(readResult),
        then: (onFulfilled: (v: typeof readResult) => unknown) =>
          Promise.resolve(readResult).then(onFulfilled),
      }
      const readChain: {
        eq: (...a: unknown[]) => unknown
        is: (...a: unknown[]) => unknown
        order: (...a: unknown[]) => unknown
        limit: (...a: unknown[]) => unknown
      } = {
        eq: vi.fn(() => readChain),
        is: vi.fn(() => readChain),
        order: vi.fn(() => readChain),
        limit: vi.fn(() => limitObj),
      }
      const readSelectFn = vi.fn(() => readChain)

      return { insert: insertFn, select: readSelectFn }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })
}

// ============================================================
// Tests POST
// ============================================================

describe('POST /api/chantiers/[id]/chat/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOuvrierSession.mockResolvedValue(null) // Pas de session ouvrier par défaut
    mockLancerPipelineBot.mockResolvedValue(undefined)
  })

  it('POST-1 : admin happy path → 201 + pipeline lancé void (D-8-10)', async () => {
    setupAdminMock()

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'POST',
      { contenu: 'Bonjour équipe !' },
      adminHeaders,
    )

    const response = await POST(req, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(201)

    const body = await response.json() as Record<string, unknown>
    expect(body['id']).toBe(MESSAGE_ID)
    expect(body['type']).toBe('user') // D-8-03 : toujours 'user'

    // D-8-10 : pipeline lancé (void — pas d'await)
    expect(mockLancerPipelineBot).toHaveBeenCalledWith(
      expect.objectContaining({
        chantierId: CHANTIER_ID,
        contenu: 'Bonjour équipe !',
        roleAppelant: 'admin',
      }),
    )
  })

  it('POST-2 : sans auth → 401', async () => {
    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'POST',
      { contenu: 'Test' },
      // Pas de headers auth
    )

    const response = await POST(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(401)
  })

  it('POST-3 : body vide → 400', async () => {
    setupAdminMock()

    const req = new NextRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: '',
      },
    )

    const response = await POST(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(400)
  })

  it('POST-4 : body type="bot" → 400 (V-8-07 BINDING)', async () => {
    setupAdminMock()

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'POST',
      { contenu: 'Test', type: 'bot' }, // V-8-07 : type != 'user' → 400
      adminHeaders,
    )

    const response = await POST(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(400)
  })

  it('POST-5 : message > 4000 chars → 400 (RG-CHAT-005)', async () => {
    setupAdminMock()

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'POST',
      { contenu: 'A'.repeat(4001) },
      adminHeaders,
    )

    const response = await POST(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(400)
  })

  it('POST-6 : chat absent (chantier pré-Sprint 8) → créé à la volée → 201', async () => {
    // chatData null = pas de chat existant → le handler le crée (get-or-create),
    // puis insère le message. Comportement self-heal pour les chantiers pré-Sprint 8.
    setupAdminMock({ chatData: null })

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'POST',
      { contenu: 'Premier message' },
      adminHeaders,
    )

    const response = await POST(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(201)

    const body = await response.json() as Record<string, unknown>
    expect(body['id']).toBe(MESSAGE_ID)
    // Pipeline lancé après création paresseuse du chat
    expect(mockLancerPipelineBot).toHaveBeenCalled()
  })

  it('FIRE-1 : D-8-10 binding — pipeline lancé sans await (ne bloque pas le 201)', async () => {
    // Simuler un pipeline lent
    let pipelineStarted = false
    mockLancerPipelineBot.mockImplementation(async () => {
      pipelineStarted = true
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    setupAdminMock()

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'POST',
      { contenu: 'Test fire-and-forget' },
      adminHeaders,
    )

    // La réponse ne doit pas attendre le pipeline
    const response = await POST(req, { params: Promise.resolve({ id: CHANTIER_ID }) })

    // 201 retourné même si le pipeline est lent
    expect(response.status).toBe(201)
    // Le pipeline a bien été lancé (void sans await — il démarre)
    expect(pipelineStarted).toBe(true)
  })
})

// ============================================================
// Tests GET
// ============================================================

describe('GET /api/chantiers/[id]/chat/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOuvrierSession.mockResolvedValue(null)
  })

  it('GET-1 : admin → 200 + messages[] (happy path)', async () => {
    // Lecture via adminClient (fix RLS ouvrier) → messages fournis par setupAdminMock
    const mockMessages = [
      {
        id: MESSAGE_ID,
        chat_id: CHAT_ID,
        chantier_id: CHANTIER_ID,
        auteur_id: USER_ID,
        auteur_nom: 'Jean Dupont',
        auteur_role: 'admin',
        type: 'user',
        contenu: 'Bonjour',
        deleted_at: null,
        action_proposal_id: null,
        created_at: new Date().toISOString(),
      },
    ]
    setupAdminMock({ messagesData: mockMessages })

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'GET',
      undefined,
      adminHeaders,
    )

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(200)

    const body = await response.json() as { messages: unknown[]; has_more: boolean }
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages.length).toBe(1)
    expect(typeof body.has_more).toBe('boolean')
  })

  it('GET-2 : limit=51 → 400 (D-8-06 enforced server-side)', async () => {
    setupAdminMock()

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages?limit=51`,
      'GET',
      undefined,
      adminHeaders,
    )

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('invalide')
  })

  it('GET-3 : unauthenticated → 401', async () => {
    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'GET',
    )

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(401)
  })

  it('RBAC-1 : ouvrier sans affectation → 404', async () => {
    const OUVRIER_ID = 'ouvrier-uuid-000-0000-000000000001'

    // Session ouvrier présente
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: OUVRIER_ID,
      organisation_id: ORG_ID,
    })

    // Pas de JWT headers → dual-path va utiliser le cookie
    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'chantiers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: CHANTIER_ID, organisation_id: ORG_ID, statut: 'actif' },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (tableName === 'affectations') {
        // Ouvrier non affecté → tableau vide
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/chat/messages`,
      'GET',
    )

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(404) // Ouvrier non affecté → 404 (ne confirme pas l'existence)
  })
})
