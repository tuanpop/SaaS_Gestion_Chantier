/**
 * __tests__/api/auth/complete-invite.test.ts
 *
 * Tests Vitest pour PATCH /api/auth/complete-invite
 * Bug fix : transition invitation_status pending→active (Zoro D-bug-invitation 2026-05-20)
 *
 * Architecture de la route :
 *   - createClient() (@/lib/supabase/server) → auth.getUser() uniquement
 *   - createAdminClient() (@/lib/supabase/admin) → UPDATE public.users
 *     (pattern documenté DECISIONLOG 2026-05-15 : createServerClient<Database>
 *      résout les mutations comme 'never' avec exactOptionalPropertyTypes:true)
 *
 * Cas couverts :
 *   CI-1 : Happy path — session valide + invitation_status='pending' → UPDATE réussi → 204
 *   CI-2 : Auth required — pas de session (getUser retourne null) → 401
 *   CI-3 : Idempotent — session valide, UPDATE affecte 0 lignes (déjà 'active') → 204
 *   CI-4 : Ownership — eq('id') appelé avec l'UID de session JWT (jamais un param externe)
 *   CI-5 : DB error — adminClient.update() retourne une erreur → 500
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted — doivent être déclarés AVANT tout import
// ============================================================

const SESSION_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const {
  mockGetUser,
  mockAdminUpdateEq,
  mockHeaders,
  mockLogger,
} = vi.hoisted(() => {
  const loggerInstance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const headersMap = new Map<string, string>([
    ['x-correlation-id', 'test-corr-complete-invite'],
  ])
  const headersObj = {
    get: (key: string) => headersMap.get(key) ?? null,
  }
  return {
    mockGetUser: vi.fn(),
    // Chaîne adminClient : .from('users').update({...}).eq('id', uid).eq('invitation_status', 'pending')
    // Le dernier .eq() retourne { error } directement.
    mockAdminUpdateEq: vi.fn(),
    mockHeaders: vi.fn().mockResolvedValue(headersObj),
    mockLogger: loggerInstance,
  }
})

// Mock next/headers — lance une erreur hors contexte Next.js
vi.mock('next/headers', () => ({
  headers: mockHeaders,
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}))

// Mock @/lib/supabase/server — utilisé uniquement pour auth.getUser()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

// Mock @/lib/supabase/admin — utilisé pour l'UPDATE public.users
// Pattern identique à users-rbac.test.ts
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (_table: string) => ({
      update: (_payload: Record<string, unknown>) => ({
        eq: (_col1: string, _val1: string) => ({
          // Second .eq() — résultat final { error }
          eq: mockAdminUpdateEq,
        }),
      }),
    }),
  })),
}))

// Mock @/lib/logger — évite les effets pino en test
vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  createRequestLogger: vi.fn().mockReturnValue(mockLogger),
}))

// ============================================================
// Tests
// ============================================================

describe('PATCH /api/auth/complete-invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Par défaut : session valide avec SESSION_USER_ID
    mockGetUser.mockResolvedValue({
      data: { user: { id: SESSION_USER_ID, email: 'conducteur@test.fr' } },
      error: null,
    })
    // Par défaut : UPDATE réussi (0 ou 1 ligne affectée — pas d'erreur)
    mockAdminUpdateEq.mockResolvedValue({ error: null })
  })

  // ----------------------------------------------------------
  // CI-1 : Happy path
  // ----------------------------------------------------------
  it('CI-1 — session valide + pending → UPDATE réussi → 204', async () => {
    const { PATCH } = await import('@/app/api/auth/complete-invite/route')
    const res = await PATCH()

    expect(res.status).toBe(204)
    // Vérifier que UPDATE a bien été appelé (transition effectuée)
    expect(mockAdminUpdateEq).toHaveBeenCalledOnce()
    // Logger info appelé pour traçabilité
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER_ID }),
      expect.stringContaining('invitation_status updated to active'),
    )
  })

  // ----------------------------------------------------------
  // CI-2 : Auth required — pas de session
  // ----------------------------------------------------------
  it('CI-2 — getUser retourne null → 401', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'not authenticated' },
    })

    const { PATCH } = await import('@/app/api/auth/complete-invite/route')
    const res = await PATCH()

    expect(res.status).toBe(401)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('Unauthorized')
    // Aucun UPDATE ne doit être tenté sans session valide
    expect(mockAdminUpdateEq).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  // ----------------------------------------------------------
  // CI-3 : Idempotent — invitation_status déjà 'active'
  // Supabase retourne { error: null } même si UPDATE affecte 0 lignes.
  // La réponse doit être 204 (succès silencieux).
  // ----------------------------------------------------------
  it('CI-3 — already active (UPDATE 0 lignes, pas erreur) → 204 idempotent', async () => {
    // Supabase retourne error: null même si le filtre WHERE ne matche aucune ligne
    mockAdminUpdateEq.mockResolvedValue({ error: null, count: 0 })

    const { PATCH } = await import('@/app/api/auth/complete-invite/route')
    const res = await PATCH()

    expect(res.status).toBe(204)
    expect(mockAdminUpdateEq).toHaveBeenCalledOnce()
  })

  // ----------------------------------------------------------
  // CI-4 : Ownership — eq('id', user.id) appelé avec l'UID de session JWT
  // T-01 : user_id vient de auth.getUser() JWT, jamais d'un paramètre externe.
  // ----------------------------------------------------------
  it('CI-4 — ownership : eq("id") appelé avec UID issu de la session JWT', async () => {
    let capturedFirstEqCol: string | undefined
    let capturedFirstEqVal: string | undefined

    // Override createAdminClient pour capturer les arguments du premier .eq()
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const mockCreateAdmin = createAdminClient as ReturnType<typeof vi.fn>
    mockCreateAdmin.mockImplementationOnce(() => ({
      from: (_table: string) => ({
        update: (_payload: Record<string, unknown>) => ({
          eq: (col: string, val: string) => {
            // Premier .eq() — capturer col et val
            capturedFirstEqCol = col
            capturedFirstEqVal = val
            return {
              eq: mockAdminUpdateEq,
            }
          },
        }),
      }),
    }))

    const { PATCH } = await import('@/app/api/auth/complete-invite/route')
    await PATCH()

    // T-01 : le premier filtre doit être eq('id', <UID de la session>)
    // — jamais un paramètre externe (body, URL, headers manipulés)
    expect(capturedFirstEqCol).toBe('id')
    expect(capturedFirstEqVal).toBe(SESSION_USER_ID)
  })

  // ----------------------------------------------------------
  // CI-5 : DB error — adminClient.update() retourne une erreur → 500
  // ----------------------------------------------------------
  it('CI-5 — DB error → 500 + log error', async () => {
    mockAdminUpdateEq.mockResolvedValue({
      error: { message: 'connection refused', code: '08006' },
    })

    const { PATCH } = await import('@/app/api/auth/complete-invite/route')
    const res = await PATCH()

    expect(res.status).toBe(500)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('Internal server error')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER_ID }),
      expect.stringContaining('failed to update invitation_status'),
    )
  })
})
