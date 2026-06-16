/**
 * __tests__/api/briefings-get.test.ts
 *
 * Tests Vitest pour GET /api/chantiers/[id]/briefings et GET /api/briefings (admin)
 * TST-K7-18/19/20/21/22 : contrôle d'accès
 *
 * Cas couverts :
 *   BG-1 : GET /api/chantiers/[id]/briefings — ouvrier → 403
 *   BG-2 : GET /api/chantiers/[id]/briefings — conducteur cross-org → 404
 *   BG-3 : GET /api/chantiers/[id]/briefings — admin happy path → 200 + briefings[]
 *   BG-4 : GET /api/chantiers/[id]/briefings — sans auth headers → 401
 *   BG-5 : GET /api/briefings — conducteur → 403 (admin only)
 *   BG-6 : GET /api/briefings — admin → 200 avec chantier_nom
 *   BG-7 : GET /api/briefings — filtres query invalides → 400
 *   BG-8 : GET /api/briefings/[id] — cross-org → 404
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockAdminFrom, mockLogger, mockCanAccessChantier, mockAnalyserMeteo } = vi.hoisted(() => {
  return {
    mockAdminFrom: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockCanAccessChantier: vi.fn().mockResolvedValue(true),
    mockAnalyserMeteo: vi.fn().mockReturnValue({ jours: [], source: 'api', code_postal: '75001', fetched_at: null }),
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/chantier-access', () => ({ canAccessChantier: mockCanAccessChantier }))
vi.mock('@/lib/briefing/analyserMeteo', () => ({ analyserMeteo: mockAnalyserMeteo }))

// ============================================================
// Helpers
// ============================================================

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_ID = 'user-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const CHANTIER_ID = 'chantier-cccc-cccc-cccc-cccccccccccc'
const BRIEFING_ID = 'briefing-dddd-dddd-dddd-dddddddddddd'

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
  method = 'GET',
) {
  return new Request(url, { method, headers })
}

const defaultAdminHeaders = {
  'x-user-id': USER_ID,
  'x-organisation-id': ORG_ID,
  'x-user-role': 'admin',
}

const defaultConducteurHeaders = {
  'x-user-id': USER_ID,
  'x-organisation-id': ORG_ID,
  'x-user-role': 'conducteur',
}

// ============================================================
// Tests
// ============================================================

describe('GET /api/chantiers/[id]/briefings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanAccessChantier.mockResolvedValue(true)
  })

  it('BG-1 : ouvrier → 403', async () => {
    const { GET } = await import('@/app/api/chantiers/[id]/briefings/route')
    const req = makeRequest(`http://localhost/api/chantiers/${CHANTIER_ID}/briefings`, {
      'x-user-id': USER_ID,
      'x-organisation-id': ORG_ID,
      'x-user-role': 'ouvrier',
    })
    const res = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(403)
  })

  it('BG-2 : conducteur cross-org (canAccessChantier=false) → 404', async () => {
    mockCanAccessChantier.mockResolvedValue(false)
    const { GET } = await import('@/app/api/chantiers/[id]/briefings/route')
    const req = makeRequest(`http://localhost/api/chantiers/${CHANTIER_ID}/briefings`, defaultConducteurHeaders)
    const res = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(404)
  })

  it('BG-3 : admin happy path → 200 avec briefings[]', async () => {
    // Mock query briefings
    const mockBriefingQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: BRIEFING_ID,
          chantier_id: CHANTIER_ID,
          annee_iso: 2026,
          semaine_iso: 26,
          contenu_genere: 'Contenu test',
          message_fallback: null,
          llm_utilise: true,
          meteo_disponible: true,
          code_postal: '75001',
          created_at: '2026-06-22T08:30:00Z',
        }],
        error: null,
      }),
      lt: vi.fn().mockReturnThis(),
    }
    mockAdminFrom.mockReturnValue(mockBriefingQuery)

    const { GET } = await import('@/app/api/chantiers/[id]/briefings/route')
    const req = makeRequest(`http://localhost/api/chantiers/${CHANTIER_ID}/briefings`, defaultAdminHeaders)
    const res = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json() as { briefings: unknown[]; next_cursor: null }
    expect(Array.isArray(body.briefings)).toBe(true)
  })

  it('BG-4 : sans headers auth → 401', async () => {
    const { GET } = await import('@/app/api/chantiers/[id]/briefings/route')
    const req = makeRequest(`http://localhost/api/chantiers/${CHANTIER_ID}/briefings`)
    const res = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/briefings (admin list)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('BG-5 : conducteur → 403 (admin only — TST-K7-21)', async () => {
    const { GET } = await import('@/app/api/briefings/route')
    const req = makeRequest('http://localhost/api/briefings', defaultConducteurHeaders)
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('BG-6 : admin → 200 avec chantier_nom (jointure F001)', async () => {
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: BRIEFING_ID,
          chantier_id: CHANTIER_ID,
          annee_iso: 2026,
          semaine_iso: 26,
          contenu_genere: 'Contenu',
          message_fallback: null,
          llm_utilise: true,
          meteo_disponible: true,
          code_postal: '75001',
          created_at: '2026-06-22T08:30:00Z',
          chantiers: { nom: 'Rénovation Leclerc' },
        }],
        error: null,
      }),
      lt: vi.fn().mockReturnThis(),
    }
    mockAdminFrom.mockReturnValue(mockQuery)

    const { GET } = await import('@/app/api/briefings/route')
    const req = makeRequest('http://localhost/api/briefings', defaultAdminHeaders)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { briefings: Array<{ chantier_nom: string }>; total: number }
    expect(body.briefings[0]?.chantier_nom).toBe('Rénovation Leclerc')
    expect(typeof body.total).toBe('number')
  })

  it('BG-7 : filtres query invalides → 400', async () => {
    const { GET } = await import('@/app/api/briefings/route')
    const req = makeRequest('http://localhost/api/briefings?limit=0', defaultAdminHeaders)
    const res = await GET(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/briefings/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanAccessChantier.mockResolvedValue(true)
  })

  it('BG-8 : cross-org (PGRST116) → 404', async () => {
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'no rows', code: 'PGRST116' },
      }),
    }
    mockAdminFrom.mockReturnValue(mockQuery)

    const { GET } = await import('@/app/api/briefings/[id]/route')
    const req = makeRequest(`http://localhost/api/briefings/${BRIEFING_ID}`, defaultAdminHeaders)
    const res = await GET(req, { params: Promise.resolve({ id: BRIEFING_ID }) })
    expect(res.status).toBe(404)
  })
})
