/**
 * tests/unit/ouvrier-session.test.ts
 * Tests unitaires helper getOuvrierSession (D-3-002 — 5 etapes obligatoires)
 * Refactorise D-054 : mocks Redis remplacees par mocks ISessionStore (lib/session-store)
 *
 * Scenarios couverts :
 *   1. Cookie absent → return null (D-3-002 etape 1)
 *   2. Cookie present mais sessionStore.read() retourne null → return null (D-3-002 etape 2)
 *   3. sessionStore.read() retourne schema invalide (Zod parse KO) → return null + log warn (D-3-002 etape 4)
 *   4. sessionStore.read() OK → touch appele (sliding window D-051/PO-005) + return session (D-3-002 etape 3)
 *   5. touch echoue → return session quand meme (best-effort D-3-002 etape 3)
 *   6. sessionStore.read() throw → return null (Postgres down)
 *
 * TST-K3 couverts : DoD D9 (touch appele a chaque hit authentifie)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockSessionStoreRead = vi.fn()
const mockSessionStoreTouch = vi.fn()
const mockSessionStoreCreate = vi.fn()
const mockSessionStoreInvalidateForUser = vi.fn()
const mockSessionStoreDelete = vi.fn()

const mockSessionStore = {
  read: (...args: unknown[]) => mockSessionStoreRead(...args),
  touch: (...args: unknown[]) => mockSessionStoreTouch(...args),
  create: (...args: unknown[]) => mockSessionStoreCreate(...args),
  invalidateForUser: (...args: unknown[]) => mockSessionStoreInvalidateForUser(...args),
  delete: (...args: unknown[]) => mockSessionStoreDelete(...args),
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

describe('getOuvrierSession — 5 etapes D-3-002 (Postgres V1 D-054)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Defaults safe
    mockSessionStoreTouch.mockResolvedValue(undefined)
  })

  it('1. Cookie absent → return null', async () => {
    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest(undefined) // pas de cookie

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
    expect(mockSessionStoreRead).not.toHaveBeenCalled()
  })

  it('2. Cookie present mais sessionStore.read retourne null (TTL expire) → return null', async () => {
    mockSessionStoreRead.mockResolvedValueOnce(null) // session absente

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('test-session-id')

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
    expect(mockSessionStoreRead).toHaveBeenCalledWith('test-session-id')
    expect(mockSessionStoreTouch).not.toHaveBeenCalled() // pas de touch si session absente
  })

  it('3. sessionStore.read retourne schema invalide (Zod parse KO) → return null', async () => {
    mockSessionStoreRead.mockResolvedValueOnce({ invalid: 'schema', missing_fields: true })

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('test-session-id')

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
    // touch est appele avant la validation Zod (etape 3 avant etape 4)
    expect(mockSessionStoreTouch).toHaveBeenCalled()
  })

  it('4. sessionStore.read OK → touch appele (sliding window) + return session valide', async () => {
    mockSessionStoreRead.mockResolvedValueOnce(VALID_SESSION)
    mockSessionStoreTouch.mockResolvedValueOnce(undefined)

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('valid-session-id')

    const result = await getOuvrierSession(request)

    expect(result).not.toBeNull()
    expect(result?.user_id).toBe(VALID_SESSION.user_id)
    expect(result?.organisation_id).toBe(VALID_SESSION.organisation_id)
    expect(result?.role).toBe('ouvrier')
    // DoD D9 : touch doit etre appele a chaque hit authentifie (sliding window)
    expect(mockSessionStoreTouch).toHaveBeenCalledWith('valid-session-id', 604800)
  })

  it('5. touch echoue → return session quand meme (best-effort)', async () => {
    mockSessionStoreRead.mockResolvedValueOnce(VALID_SESSION)
    mockSessionStoreTouch.mockRejectedValueOnce(new Error('Postgres connection lost'))

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('valid-session-id')

    const result = await getOuvrierSession(request)

    // La session est retournee meme si touch echoue (best-effort D-3-002 etape 3)
    expect(result).not.toBeNull()
    expect(result?.user_id).toBe(VALID_SESSION.user_id)
  })

  it('6. sessionStore.read throw → return null (Postgres down)', async () => {
    mockSessionStoreRead.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const { getOuvrierSession } = await import('../../lib/ouvrier-session')
    const request = buildRequest('valid-session-id')

    const result = await getOuvrierSession(request)

    expect(result).toBeNull()
  })
})
