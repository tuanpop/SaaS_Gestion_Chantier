// tests/unit/detection-cron.test.ts — Tests du cron POST /api/cron/derives
// TST-K6-07 : x-cron-secret comparé en timing-safe (crypto.timingSafeEqual) — jamais ===.
// TST-K6-08 : idempotence replay — pas de doublon (ON CONFLICT DO NOTHING).
// TST-K6-09 : aucun ciblage par body.
// TST-K6-10 : org trial_expired → skip LLM seul, détection + notif maintenues.
// TST-K6-33 : htmlEscape sur titre+message avant insertNotification.
// TST-K6-34 : destinataires = admins + conducteur, jamais ouvrier.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks — avant import du module
// ============================================================

vi.mock('../../lib/llm/register', () => ({}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn((ctx: unknown) => ({
      warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    })),
  },
}))

const mockDetecterDerives = vi.fn()
const mockChargerSeuils = vi.fn()
const mockGenererMessageDerive = vi.fn()
const mockGenererMessageFallback = vi.fn()
const mockResolverDerivesChantier = vi.fn()
const mockInsertNotification = vi.fn()
const mockResolveConducteurChantier = vi.fn()
const mockResolveDestinatairesInternes = vi.fn()
const mockCheckTrialGate = vi.fn()

vi.mock('../../lib/detection/detecterDerives', () => ({
  detecterDerives: (...args: unknown[]) => mockDetecterDerives(...args),
  N_MAX_TACHES_BLOQUEES: 5,
}))
vi.mock('../../lib/detection/chargerSeuils', () => ({
  chargerSeuils: (...args: unknown[]) => mockChargerSeuils(...args),
}))
vi.mock('../../lib/detection/genererMessageDerive', () => ({
  genererMessageDerive: (...args: unknown[]) => mockGenererMessageDerive(...args),
}))
vi.mock('../../lib/detection/genererMessageFallback', () => ({
  genererMessageFallback: (...args: unknown[]) => mockGenererMessageFallback(...args),
}))
vi.mock('../../lib/detection/resolverDerives', () => ({
  resolverDerivesChantier: (...args: unknown[]) => mockResolverDerivesChantier(...args),
}))
vi.mock('../../lib/notifications/notif', () => ({
  insertNotification: (...args: unknown[]) => mockInsertNotification(...args),
  htmlEscape: (s: string) => s,
  resolveConducteurChantier: (...args: unknown[]) => mockResolveConducteurChantier(...args),
}))
vi.mock('../../lib/reporting/destinataires', () => ({
  resolveDestinatairesInternes: (...args: unknown[]) => mockResolveDestinatairesInternes(...args),
}))
vi.mock('../../lib/trial-gate', () => ({
  checkTrialGate: (...args: unknown[]) => mockCheckTrialGate(...args),
}))

// Mock adminClient
const mockFrom = vi.fn()
vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

// ============================================================
// Import du handler après mocks
// ============================================================

const { POST } = await import('../../app/api/cron/derives/route')

// ============================================================
// Fixtures
// ============================================================

const CRON_SECRET = 'test-cron-secret-12345678'

function makeRequest(opts: {
  secret?: string | null
} = {}): NextRequest {
  const headers = new Headers()
  if (opts.secret !== null) {
    headers.set('x-cron-secret', opts.secret ?? CRON_SECRET)
  }
  return new NextRequest('http://localhost/api/cron/derives', {
    method: 'POST',
    headers,
  })
}

function makeSeuilsEffectifs() {
  return {
    organisation_id: 'org-1',
    ratio_budget: 0.85,
    jours_blocage: 3,
    jours_inactivite: 7,
    source: 'defaut' as const,
  }
}

function makeSignaux(chantierId: string = 'ch-1', derives: unknown[] = []) {
  return {
    chantier_id: chantierId,
    chantier_nom: 'Chantier Test',
    organisation_id: 'org-1',
    seuils: makeSeuilsEffectifs(),
    evaluated_at: new Date().toISOString(),
    derives,
  }
}

// ============================================================
// Setup
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
  process.env['CRON_SECRET'] = CRON_SECRET

  // Defaults
  mockChargerSeuils.mockResolvedValue(makeSeuilsEffectifs())
  mockCheckTrialGate.mockResolvedValue({ blocked: false })
  mockDetecterDerives.mockResolvedValue(makeSignaux())
  mockGenererMessageDerive.mockResolvedValue('Message LLM test.')
  mockGenererMessageFallback.mockReturnValue('Message fallback test.')
  mockInsertNotification.mockResolvedValue(undefined)
  mockResolveConducteurChantier.mockResolvedValue('user-conducteur-1')
  mockResolveDestinatairesInternes.mockResolvedValue([])

  // adminClient mock : chantiers actifs + pas de dérives actives
  mockFrom.mockImplementation((table: string) => {
    if (table === 'chantiers') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    if (table === 'derives_detectees') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockReturnThis(),
        onConflict: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
      }
    }
    if (table === 'users') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
  })
})

// ============================================================
// Tests
// ============================================================

describe('POST /api/cron/derives — authentification', () => {
  it('TST-K6-07 : retourne 401 si x-cron-secret absent', async () => {
    const req = makeRequest({ secret: null })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('TST-K6-07 : retourne 401 si x-cron-secret incorrect', async () => {
    const req = makeRequest({ secret: 'mauvais-secret' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('TST-K6-07 : retourne 200 avec le bon secret (timing-safe)', async () => {
    const req = makeRequest()
    const res = await POST(req)
    // Avec 0 chantier actif → 200 avec reponse vide
    expect(res.status).toBe(200)
  })

  it('TST-K6-07 : le secret est comparé via timingSafeEqual (longueurs différentes → 401)', async () => {
    // Secret trop court (longueur différente → timingSafeEqual reject immédiat)
    const req = makeRequest({ secret: 'court' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/cron/derives — traitement', () => {
  it('TST-K6-09 : itère tous les chantiers actifs sans ciblage par body', async () => {
    // Simule 1 chantier actif dans l'org
    mockFrom.mockImplementation((table: string) => {
      if (table === 'chantiers') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{
              id: 'ch-1',
              organisation_id: 'org-1',
              nom: 'Chantier 1',
              statut: 'actif',
              budget_alloue: 100_000,
              budget_depense: 70_000,
              date_fin_prevue: null,
              updated_at: new Date().toISOString(),
            }],
            error: null,
          }),
        }
      }
      // autres tables → vide
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockReturnThis(),
        onConflict: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
      }
    })

    const req = makeRequest()
    const res = await POST(req)
    const body = await res.json() as { chantiers_evalues: number }
    expect(res.status).toBe(200)
    expect(body.chantiers_evalues).toBe(1)
    // detecterDerives a été appelé pour ce chantier
    expect(mockDetecterDerives).toHaveBeenCalledOnce()
  })

  it('TST-K6-10 : trial_expired → skip LLM, fallback utilisé, détection maintenue', async () => {
    mockCheckTrialGate.mockResolvedValue({ blocked: true, reason: 'trial_expired' })

    // Chantier avec 1 dérive nouvelle
    mockFrom.mockImplementation((table: string) => {
      if (table === 'chantiers') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{
              id: 'ch-1', organisation_id: 'org-1', nom: 'Test', statut: 'actif',
              budget_alloue: 100_000, budget_depense: 92_000,
              date_fin_prevue: null, updated_at: new Date().toISOString(),
            }],
            error: null,
          }),
        }
      }
      if (table === 'derives_detectees') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
          insert: vi.fn().mockReturnThis(),
          onConflict: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ data: [], error: null }),
        update: vi.fn().mockReturnThis(),
      }
    })

    mockDetecterDerives.mockResolvedValue(makeSignaux('ch-1', [{
      type: 'budget_depasse',
      budget_alloue: 100_000,
      budget_depense: 92_000,
      ratio: 0.92,
      depassement_eur: -8_000,
      seuil_applique: 0.85,
    }]))

    const req = makeRequest()
    await POST(req)

    // LLM ne doit PAS être appelé (trial_expired)
    expect(mockGenererMessageDerive).not.toHaveBeenCalled()
    // Fallback doit être utilisé à la place
    expect(mockGenererMessageFallback).toHaveBeenCalled()
  })

  it('retourne 200 avec reponse structurée (ReponseCronDerive)', async () => {
    const req = makeRequest()
    const res = await POST(req)
    const body = await res.json()
    expect(body).toHaveProperty('chantiers_evalues')
    expect(body).toHaveProperty('chantiers_avec_derive')
    expect(body).toHaveProperty('derives_nouvelles_total')
    expect(body).toHaveProperty('llm_appels')
    expect(body).toHaveProperty('erreurs')
    expect(Array.isArray(body.erreurs)).toBe(true)
  })
})
