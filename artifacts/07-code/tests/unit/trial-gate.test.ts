/**
 * tests/unit/trial-gate.test.ts — Tests unitaires Vitest pour lib/trial-gate.ts
 *
 * Scénarios couverts (SPRINT_1_PLAN.md §7.1) :
 *   1. statut='trial_active' + trial_ends_at > now() -> { blocked: false }
 *   2. statut='trial_expired' -> { blocked: true, reason: 'trial_expired' }
 *   3. trial_ends_at < now() (même si statut='trial_active') -> { blocked: true }
 *   4. assertTrialActive() sur org trial_expired -> throws PaymentRequiredError (statusCode 402)
 *
 * Le Supabase client est mocké via vi.fn() — aucune connexion DB réelle.
 * Le module Redis est mocké pour éviter une dépendance Redis en test unitaire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { checkTrialGate, assertTrialActive } from '../../lib/trial-gate'
import { PaymentRequiredError } from '../../lib/errors'

// ============================================================
// Mock Redis — trial-gate importe Redis dynamiquement
// On mock le module entier pour que les tests soient sans état Redis
// ============================================================

vi.mock('../../lib/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),          // cache toujours miss en test
    set: vi.fn().mockResolvedValue('OK'),
  },
  checkRateLimit: vi.fn(),
  RATE_LIMITS: {
    login: { limit: 5, windowMs: 15 * 60 * 1000 },
    signup: { limit: 10, windowMs: 60 * 60 * 1000 },
    magicLink: { limit: 5, windowMs: 15 * 60 * 1000 },
  },
}))

// ============================================================
// Factory : créer un mock SupabaseClient avec une organisation donnée
// ============================================================

interface MockOrgData {
  id?: string
  statut?: 'trial_active' | 'trial_expired' | 'active' | 'suspended'
  trial_ends_at?: string
}

/**
 * Crée un mock minimal de SupabaseClient<Database> qui retourne l'organisation spécifiée.
 * Seuls les méthodes utilisées par checkTrialGate() sont mockées.
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
    // Propriétés nécessaires pour satisfaire le type SupabaseClient (non utilisées ici)
    auth: {},
    rpc: vi.fn(),
    storage: {},
    realtime: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: mock minimal, type complet non nécessaire
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
// Tests
// ============================================================

describe('checkTrialGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ----------------------------------------------------------
  // Scénario 1 : trial actif + date future -> non bloqué
  // ----------------------------------------------------------

  it('GIVEN statut=trial_active ET trial_ends_at > now() WHEN checkTrialGate() THEN { blocked: false }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-1',
      statut: 'trial_active',
      trial_ends_at: futureDate(10),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-1')

    expect(result).toEqual({ blocked: false })
  })

  // ----------------------------------------------------------
  // Scénario 2 : statut='trial_expired' -> bloqué
  // ----------------------------------------------------------

  it('GIVEN statut=trial_expired WHEN checkTrialGate() THEN { blocked: true, reason: trial_expired }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-2',
      statut: 'trial_expired',
      trial_ends_at: pastDate(5),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-2')

    expect(result).toEqual({ blocked: true, reason: 'trial_expired' })
  })

  // ----------------------------------------------------------
  // Scénario 3 : trial_ends_at < now() même si statut != 'trial_expired' -> bloqué
  // Cas : cron de mise à jour statut pas encore passé, mais date dépassée
  // ----------------------------------------------------------

  it('GIVEN trial_ends_at < now() ET statut=trial_active WHEN checkTrialGate() THEN { blocked: true, reason: trial_expired }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-3',
      statut: 'trial_active',
      trial_ends_at: pastDate(1),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-3')

    expect(result).toEqual({ blocked: true, reason: 'trial_expired' })
  })

  // ----------------------------------------------------------
  // Cas bonus : organisation introuvable -> bloqué avec reason='not_found'
  // ----------------------------------------------------------

  it('GIVEN organisation introuvable WHEN checkTrialGate() THEN { blocked: true, reason: not_found }', async () => {
    const supabase = createMockSupabaseClient(null)

    const result = await checkTrialGate(supabase, 'org-inexistante')

    expect(result).toEqual({ blocked: true, reason: 'not_found' })
  })

  // ----------------------------------------------------------
  // Cas bonus : statut='suspended' -> bloqué
  // ----------------------------------------------------------

  it('GIVEN statut=suspended WHEN checkTrialGate() THEN { blocked: true }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-5',
      statut: 'suspended',
      trial_ends_at: futureDate(30),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-5')

    expect(result.blocked).toBe(true)
  })

  // ----------------------------------------------------------
  // Cas bonus : statut='active' (plan payant) + date future -> non bloqué
  // ----------------------------------------------------------

  it('GIVEN statut=active (plan payant) ET trial_ends_at > now() WHEN checkTrialGate() THEN { blocked: false }', async () => {
    const supabase = createMockSupabaseClient({
      id: 'org-uuid-6',
      statut: 'active',
      trial_ends_at: futureDate(365),
    })

    const result = await checkTrialGate(supabase, 'org-uuid-6')

    expect(result).toEqual({ blocked: false })
  })
})

// ============================================================
// Tests assertTrialActive
// ============================================================

describe('assertTrialActive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ----------------------------------------------------------
  // Scénario 4 : assertTrialActive sur org trial_expired -> throw PaymentRequiredError
  // ----------------------------------------------------------

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

    // Ne doit pas throw
    await expect(
      assertTrialActive(supabase, 'org-uuid-active'),
    ).resolves.toBeUndefined()
  })

  it('GIVEN trial_ends_at dans le passé même si statut=trial_active WHEN assertTrialActive() THEN throws PaymentRequiredError', async () => {
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
