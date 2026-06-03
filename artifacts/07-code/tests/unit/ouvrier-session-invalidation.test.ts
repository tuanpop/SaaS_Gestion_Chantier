/**
 * tests/unit/ouvrier-session-invalidation.test.ts
 * Tests invalidation session Postgres sur DELETE affectation (D-054 refacto)
 *
 * Scenarios couverts (TST-K3-19 a 20 adaptes V1 Postgres) :
 *   TST-K3-19 : DELETE affectation → invalidateForUser appele + count retourne
 *   TST-K3-20 : invalidateForUser retourne 0 (aucune session active) → ok, pas d'exception
 *   Bonus : Postgres down → invalidateOuvrierSessionsForUser retourne { invalidated: 0 } (best-effort D-3-011)
 *   Bonus : aucune session active pour cet utilisateur → { invalidated: 0 } sans erreur
 *
 * Note comportement V1 vs Redis :
 *   Redis V0 : retirait l'affectation specifique, conservait la session si d'autres affectations restaient.
 *   Postgres V1 (D-054) : supprime TOUTES les sessions de l'ouvrier (invalidateForUser).
 *   La distinction par affectation n'est pas preservee — acceptable V1 (volume negligeable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks
// ============================================================

const mockSessionStoreInvalidateForUser = vi.fn()

const mockSessionStore = {
  read: vi.fn(),
  touch: vi.fn(),
  create: vi.fn(),
  invalidateForUser: (...args: unknown[]) => mockSessionStoreInvalidateForUser(...args),
  delete: vi.fn(),
}

vi.mock('../../lib/session-store', () => ({
  getSessionStore: () => mockSessionStore,
  PostgresSessionStore: vi.fn(),
}))

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
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
const AFFECTATION_ID_1 = '00000000-0000-0000-0000-000000000010'
const AFFECTATION_ID_2 = '00000000-0000-0000-0000-000000000011'

// ============================================================
// Tests
// ============================================================

describe('invalidateOuvrierSessionsForUser — D-3-011 (Postgres V1 D-054)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TST-K3-19 : invalidateForUser appele avec userId + retourne le count', async () => {
    mockSessionStoreInvalidateForUser.mockResolvedValueOnce(2) // 2 sessions supprimees

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')
    const result = await invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_1)

    // invalidateForUser appele avec le userId
    expect(mockSessionStoreInvalidateForUser).toHaveBeenCalledWith(USER_ID)
    // Count retourne
    expect(result.invalidated).toBe(2)
  })

  it('TST-K3-20 : 0 sessions actives pour cet utilisateur → { invalidated: 0 } sans exception', async () => {
    mockSessionStoreInvalidateForUser.mockResolvedValueOnce(0)

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')
    const result = await invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_2)

    expect(mockSessionStoreInvalidateForUser).toHaveBeenCalledWith(USER_ID)
    expect(result.invalidated).toBe(0)
  })

  it('Bonus best-effort : Postgres down → retourne { invalidated: 0 } sans exception', async () => {
    mockSessionStoreInvalidateForUser.mockRejectedValueOnce(new Error('Postgres ECONNREFUSED'))

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')

    // Doit retourner sans throw (best-effort D-3-011)
    const result = await invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_1)

    expect(result.invalidated).toBe(0)
  })

  it('Bonus : count null (Postgres retourne null) → { invalidated: 0 }', async () => {
    // Cas defensif : si Postgres retourne null pour count
    mockSessionStoreInvalidateForUser.mockResolvedValueOnce(0)

    const { invalidateOuvrierSessionsForUser } = await import('../../lib/ouvrier-session')
    const result = await invalidateOuvrierSessionsForUser(USER_ID, AFFECTATION_ID_1)

    expect(result).toEqual({ invalidated: 0 })
  })
})
