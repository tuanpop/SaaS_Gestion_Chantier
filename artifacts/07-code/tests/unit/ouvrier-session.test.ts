/**
 * tests/unit/ouvrier-session.test.ts
 * Tests unitaires helper getOuvrierSession (D-3-002 — 5 etapes obligatoires)
 *
 * Scenarios couverts :
 *   1. Cookie absent → return null (D-3-002 etape 1)
 *   2. Cookie present mais cle Redis null → return null (D-3-002 etape 2)
 *   3. Redis retourne JSON invalide (Zod parse KO) → return null + log warn (D-3-002 etape 4)
 *   4. Redis OK → EXPIRE appele + return session (sliding window D-051/PO-005) (D-3-002 etape 3)
 *   5. EXPIRE echoue → return session quand meme (best-effort D-3-002 etape 3)
 *
 * TST-K3 couverts : DoD D9 (redis.expire appele a chaque hit authentifie)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockRedisGet = vi.fn()
const mockRedisExpire = vi.fn()

vi.mock('../../lib/redis', () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    setex: vi.fn(),
    sadd: vi.fn(),
    smembers: vi.fn().mockResolvedValue([]),
    del: vi.fn(),
    srem: vi.fn(),
  },
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    })),
  },
}))

// ============================================================
// Helper pour construire un mock NextRequest avec cookie
// ============================================================

function buildRequest(sessionId?: string): NextRequest {
  const cookies = new Map<string, { value: string }>()
  if (sessionId) {
    cookies.set('ouvrier_session', { value: sessionId })
  }
  return {
    cookies: {
      get: (name: string) => cookies.get(name),
    },
    headers: new Headers(),
  } as unknown as NextRequest
}

// Session valide pour les tests
const VALID_SESSION = {
  user_id: '00000000-0000-0000-0000-000000000001',
  organisation_id: '00000000-0000-0000-0000-000000000002',
  role: 'ouvrier' as const,
  affectations: [
    {
      affectation_id: '00000000-0000-0000-0000-000000000003',
      chantier_id: '00000000-0000-0000-0000-000000000004',
      vue: 'mes_taches' as const,
    },
  ],
  created_at: Date.now(),
}

// ============================================================
// Tests
// ============================================================

describe('getOuvrierSession — 5 etapes D-3-002', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. Cookie absent → return null', async () => {
    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest(undefined) // pas de cookie

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
    expect(mockRedisGet).not.toHaveBeenCalled()
  })

  it('2. Cookie present mais cle Redis null (TTL expire) → return null', async () => {
    mockRedisGet.mockResolvedValueOnce(null) // cle absente de Redis

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('test-session-id')

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
    expect(mockRedisGet).toHaveBeenCalledWith('ouvrier_session:test-session-id')
    expect(mockRedisExpire).not.toHaveBeenCalled() // pas d'expire si cle absente
  })

  it('3. Redis retourne JSON invalide (Zod parse KO) → return null', async () => {
    mockRedisGet.mockResolvedValueOnce('{"invalid": "schema", "missing_fields": true}')
    mockRedisExpire.mockResolvedValueOnce(1) // expire reussit

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('test-session-id')

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
    // expire est appele avant la validation Zod (etape 3 avant etape 4)
    expect(mockRedisExpire).toHaveBeenCalled()
  })

  it('4. Redis OK → EXPIRE appele (sliding window) + return session valide', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(VALID_SESSION))
    mockRedisExpire.mockResolvedValueOnce(1) // expire reussit

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('valid-session-id')

    const result = await getOuvrierSession(request)

    expect(result).not.toBeNull()
    expect(result?.user_id).toBe(VALID_SESSION.user_id)
    expect(result?.organisation_id).toBe(VALID_SESSION.organisation_id)
    expect(result?.role).toBe('ouvrier')
    // DoD D9 : EXPIRE doit etre appele a chaque hit authentifie (sliding window)
    expect(mockRedisExpire).toHaveBeenCalledWith('ouvrier_session:valid-session-id', 604800)
  })

  it('5. EXPIRE echoue → return session quand meme (best-effort)', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(VALID_SESSION))
    mockRedisExpire.mockRejectedValueOnce(new Error('Redis connection lost'))

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('valid-session-id')

    const result = await getOuvrierSession(request)

    // La session est retournee meme si EXPIRE echoue (best-effort D-3-002 etape 3)
    expect(result).not.toBeNull()
    expect(result?.user_id).toBe(VALID_SESSION.user_id)
  })

  it('Redis get echoue → return null (Redis down)', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('valid-session-id')

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
  })
})
