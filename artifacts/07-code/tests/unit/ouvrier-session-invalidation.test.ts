/**
 * tests/unit/ouvrier-session-invalidation.test.ts
 * Tests integration invalidation session Redis sur DELETE affectation
 *
 * Scenarios couverts (TST-K3-19 a 20) :
 *   TST-K3-19 : DELETE affectation → session Redis reconstruite sans cette affectation
 *   TST-K3-20 : DELETE affectation unique → session entiere supprimee
 *   Bonus : invalidation Redis echoue → DELETE retourne quand meme 200 (best-effort D-3-011)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks
// ============================================================

const mockRedisSmembers = vi.fn()
const mockRedisGet = vi.fn()
const mockRedisSetex = vi.fn()
const mockRedisDel = vi.fn()
const mockRedisSrem = vi.fn()

vi.mock('../../lib/redis', () => ({
  redis: {
    smembers: (...args: unknown[]) => mockRedisSmembers(...args),
    get: (...args: unknown[]) => mockRedisGet(...args),
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    srem: (...args: unknown[]) => mockRedisSrem(...args),
    expire: vi.fn(),
    sadd: vi.fn(),
  },
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

// ============================================================
// Fixtures
// ============================================================

const USER_ID = '00000000-0000-0000-0000-000000000001'
const ORG_ID = '00000000-0000-0000-0000-000000000002'
const AFFECTATION_ID_1 = '00000000-0000-0000-0000-000000000010'
const AFFECTATION_ID_2 = '00000000-0000-0000-0000-000000000011'
const CHANTIER_ID_1 = '00000000-0000-0000-0000-000000000020'
const CHANTIER_ID_2 = '00000000-0000-0000-0000-000000000021'
const SESSION_ID = 'test-session-id-abc'

function makeSession(affectations: Array<{ affectation_id: string; chantier_id: string }>) {
  return JSON.stringify({
    user_id: USER_ID,
    organisation_id: ORG_ID,
    role: 'ouvrier',
    affectations: affectations.map((a) => ({ ...a, vue: 'mes_taches' })),
    created_at: Date.now(),
  })
}

// ============================================================
// Tests
// ============================================================

describe('invalidateOuvrierSessionsForUser — D-3-011', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TST-K3-19 : 2 affectations → session reconstruite sans l affectation supprimee', async () => {
    // Session avec 2 affectations
    const sessionWithTwo = makeSession([
      { affectation_id: AFFECTATION_ID_1, chantier_id: CHANTIER_ID_1 },
      { affectation_id: AFFECTATION_ID_2, chantier_id: CHANTIER_ID_2 },
    ])

    mockRedisSmembers.mockResolvedValueOnce([SESSION_ID])
    mockRedisGet.mockResolvedValueOnce(sessionWithTwo)
    mockRedisSetex.mockResolvedValueOnce('OK')

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')
    await invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_1)

    // Session reconstituee avec l'affectation restante (AFFECTATION_ID_2)
    expect(mockRedisSetex).toHaveBeenCalledWith(
      `ouvrier_session:${SESSION_ID}`,
      604800,
      expect.stringContaining(AFFECTATION_ID_2),
    )

    // L'affectation supprimee ne doit PAS etre dans la nouvelle session
    const newSessionStr = mockRedisSetex.mock.calls[0][2] as string
    expect(newSessionStr).not.toContain(AFFECTATION_ID_1)
    expect(newSessionStr).toContain(AFFECTATION_ID_2)

    // DEL pas appele (session conservee avec 1 affectation restante)
    expect(mockRedisDel).not.toHaveBeenCalled()
  })

  it('TST-K3-20 : 1 affectation unique → session entiere supprimee (DEL)', async () => {
    // Session avec 1 seule affectation
    const sessionWithOne = makeSession([
      { affectation_id: AFFECTATION_ID_1, chantier_id: CHANTIER_ID_1 },
    ])

    mockRedisSmembers.mockResolvedValueOnce([SESSION_ID])
    mockRedisGet.mockResolvedValueOnce(sessionWithOne)

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')
    await invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_1)

    // DEL appele : plus d'affectations → session supprimee
    expect(mockRedisDel).toHaveBeenCalledWith(`ouvrier_session:${SESSION_ID}`)
    expect(mockRedisSrem).toHaveBeenCalledWith(
      `ouvrier_user_sessions:${USER_ID}`,
      SESSION_ID,
    )

    // SETEX pas appele (session supprimee, pas reconstruite)
    expect(mockRedisSetex).not.toHaveBeenCalled()
  })

  it('Bonus best-effort : SMEMBERS echoue → fonction retourne sans exception', async () => {
    mockRedisSmembers.mockRejectedValueOnce(new Error('Redis ECONNREFUSED'))

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')

    // Doit retourner sans throw (best-effort D-3-011)
    await expect(
      invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_1),
    ).resolves.toBeUndefined()

    // Aucune operation Redis en plus
    expect(mockRedisGet).not.toHaveBeenCalled()
    expect(mockRedisDel).not.toHaveBeenCalled()
  })

  it('Bonus : aucune session active pour cet utilisateur → rien a faire', async () => {
    mockRedisSmembers.mockResolvedValueOnce([]) // pas de sessions

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')
    await invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_1)

    expect(mockRedisGet).not.toHaveBeenCalled()
    expect(mockRedisDel).not.toHaveBeenCalled()
  })
})
