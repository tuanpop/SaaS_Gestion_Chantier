/**
 * tests/unit/trial-gate.test.ts — Tests unitaires Vitest pour lib/trial-gate.ts
 * Refactorise D-054 : mocks Redis remplacees par spies sur cacheGet/cacheSet (lib/cache)
 *
 * Scenarios couverts (SPRINT_1_PLAN.md §7.1) :
 *   1. statut='trial_active' + trial_ends_at > now() -> { blocked: false }
 *   2. statut='trial_expired' -> { blocked: true, reason: 'trial_expired' }
 *   3. trial_ends_at < now() (meme si statut='trial_active') -> { blocked: true }
 *   4. assertTrialActive() sur org trial_expired -> throws PaymentRequiredError (statusCode 402)
 *   5. Cache hit → DB non appelee
 *
 * Le Supabase client est mocke via vi.fn() — aucune connexion DB reelle.
 * lib/cache est mocke pour controler le comportement du cache memoire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { checkTrialGate, assertTrialActive } from '../../lib/trial-gate'
import { PaymentRequiredError } from '../../lib/errors'

// ============================================================
// Mock lib/cache — trial-gate utilise cacheGet/cacheSet (D-054)
// ============================================================

const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()

vi.mock('../../lib/cache', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDel: vi.fn(),
  checkRateLimit: vi.fn(),
  RATE_LIMITS: {
    login: { limit: 5, windowMs: 15 * 60 * 1000 },
    signup: { limit: 10, windowMs: 60 * 60 * 1000 },
    magicLink: { limit: 5, windowMs: 15 * 60 * 1000 },
  },
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

// ============================================================
// Factory : creer un mock SupabaseClient avec une organisation donnee
// ============================================================

interface MockOrgData {
  id?: string
  statut?: 'trial_active' | 'trial_expired' | 'active' | 'suspended'
  trial_ends_at?: string
}

/**
 * Cree un mock minimal de SupabaseClient<Database> qui retourne l'organisation specifiee.
 */
function createMockSupabaseClient(orgData: MockOrgData | null) {
  const singleFn: Mock = vi.fn().mockResolvedValue(
    orgData
      ? { data: orgData, error: null }
      : { data: null, error: { message: 'Row not found', code: 'PGRST116' } },
  )

  const eqFn: Mock = vi.fn().mockReturnValue({ single: singleFn })
  const selectFn: Mock = vi.fn().mockReturnValue({ eq: eqFn })
  const fromFn: Mock = vi.fn().mockReturnValue({ select: selectFn })

  return {
    from: fromFn,
    auth: {},
    rpc: vi.fn(),
    storage: {},
    realtime: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: mock minimal, type complet non necessaire
  } as unknown as import('@supabase/supabase-js').SupabaseClient<import('../../types/database').Database>
}

// ============================================================
// Helpers de date
// ============================================================

function futureDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString()
}

function pastDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

// ============================================================
// Tests checkTrialGate
// ============================================================

describe('checkTrialGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Par defaut : cache miss
    mockCacheGet.mockReturnValue(null)
    mockCacheSet.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GIVEN statut=trial_active ET trial_ends_at > now() WHEN checkTrialGate() THEN { blocked: false }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-1',
      statut: 'trial_active',
      trial_ends_at: futureDate(10),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-1')

    expect(result).toEqual({ blocked: false })
  })

  it('GIVEN statut=trial_expired WHEN checkTrialGate() THEN { blocked: true, reason: trial_expired }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-2',
      statut: 'trial_expired',
      trial_ends_at: pastDate(5),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-2')

    expect(result).toEqual({ blocked: true, reason: 'trial_expired' })
  })

  it('GIVEN trial_ends_at < now() ET statut=trial_active WHEN checkTrialGate() THEN { blocked: true, reason: trial_expired }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-3',
      statut: 'trial_active',
      trial_ends_at: pastDate(1),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-3')

    expect(result).toEqual({ blocked: true, reason: 'trial_expired' })
  })

  it('GIVEN organisation introuvable WHEN checkTrialGate() THEN { blocked: true, reason: not_found }', async () => {
    const supabase = createMockSupabaseClient(null)

    const result = await checkTrialGate(supabase, 'org-inexistante')

    expect(result).toEqual({ blocked: true, reason: 'not_found' })
  })

  it('GIVEN statut=suspended WHEN checkTrialGate() THEN { blocked: true }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-5',
      statut: 'suspended',
      trial_ends_at: futureDate(30),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-5')

    expect(result.blocked).toBe(true)
  })

  it('GIVEN statut=active (plan payant) ET trial_ends_at > now() WHEN checkTrialGate() THEN { blocked: false }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-6',
      statut: 'active',
      trial_ends_at: futureDate(365),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-6')

    expect(result).toEqual({ blocked: false })
  })

  it('GIVEN cache hit WHEN checkTrialGate() THEN DB non appelee', async () => {
    // Simuler un cache hit
    mockCacheGet.mockReturnValueOnce({ blocked: false })

    const supabase = createMockSupabaseClient({
      id: 'org-cached',
      statut: 'trial_active',
      trial_ends_at: futureDate(5),
    })

    const result = await checkTrialGate(supabase, 'org-cached')

    expect(result).toEqual({ blocked: false })
    // DB non appelee (cache hit)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('GIVEN cache miss WHEN checkTrialGate() THEN cacheSet appele apres DB', async () => {
    mockCacheGet.mockReturnValue(null) // cache miss

    const supabase = createMockSupabaseClient({
      id: 'org-uuid-set',
      statut: 'trial_active',
      trial_ends_at: futureDate(5),
    })

    await checkTrialGate(supabase, 'org-uuid-set')

    // cacheSet doit avoir ete appele avec le store 'trial-gate', la cle org ID, le resultat, TTL 60000ms
    expect(mockCacheSet).toHaveBeenCalledWith(
      'trial-gate',
      'org-uuid-set',
      { blocked: false },
      60_000,
    )
  })
})

// ============================================================
// Tests assertTrialActive
// ============================================================

describe('assertTrialActive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCacheGet.mockReturnValue(null)
    mockCacheSet.mockReturnValue(undefined)
  })

  it('GIVEN org trial_expired WHEN assertTrialActive() THEN throws PaymentRequiredError (statusCode 402)', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-4',
      statut: 'trial_expired',
      trial_ends_at: pastDate(3),
    })

    await expect(
      assertTrialActive(supabase, 'org-uuid-4'),
    ).rejects.toThrow(PaymentRequiredError)
  })

  it('GIVEN org trial_expired WHEN assertTrialActive() THEN erreur avec statusCode 402', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-4b',
      statut: 'trial_expired',
      trial_ends_at: pastDate(3),
    })

    let thrownError: unknown
    try {
      await assertTrialActive(supabase, 'org-uuid-4b')
    } catch (err) {
      thrownError = err
    }

    expect(thrownError).toBeInstanceOf(PaymentRequiredError)
    expect((thrownError as PaymentRequiredError).statusCode).toBe(402)
  })

  it('GIVEN org trial_active ET trial_ends_at > now() WHEN assertTrialActive() THEN ne throw pas', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-active',
      statut: 'trial_active',
      trial_ends_at: futureDate(7),
    })

    await expect(
      assertTrialActive(supabase, 'org-uuid-active'),
    ).resolves.toBeUndefined()
  })

  it('GIVEN trial_ends_at dans le passe meme si statut=trial_active WHEN assertTrialActive() THEN throws PaymentRequiredError', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-expired-date',
      statut: 'trial_active',
      trial_ends_at: pastDate(2),
    })

    await expect(
      assertTrialActive(supabase, 'org-uuid-expired-date'),
    ).rejects.toThrow(PaymentRequiredError)
  })
})
