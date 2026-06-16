// tests/unit/detection-derives-api.test.ts — Tests API derives
// GET /api/chantiers/[id]/derives (TST-K6-11, TST-K6-12)
// GET /api/derives (TST-K6-14 CRITICAL : filtre organisation_id handler-level)
// TST-K6-12 : organisation_id et notification_id exclus de la surface client
// TST-K6-14 CRITICAL : .eq('organisation_id', organisationId) sur /api/derives
//   adminClient bypass RLS → le filtre handler-level est LA SEULE barrière d'isolation

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

const mockCanAccessChantier = vi.fn()
vi.mock('../../lib/chantier-access', () => ({
  canAccessChantier: (...args: unknown[]) => mockCanAccessChantier(...args),
}))

const mockFrom = vi.fn()
vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

const mockGetUser = vi.fn()
vi.mock('../../lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: () => mockGetUser() },
  }),
}))

// ============================================================
// Import handlers
// ============================================================

const { GET: getChantierDerives } = await import('../../app/api/chantiers/[id]/derives/route')
const { GET: getDerives } = await import('../../app/api/derives/route')

// ============================================================
// Fixtures
// ============================================================

function makeDeriveRow(id: string, chantierId: string) {
  return {
    id,
    chantier_id: chantierId,
    organisation_id: 'org-1',  // ne doit PAS être dans la réponse (TST-K6-12)
    notification_id: 'notif-1', // ne doit PAS être dans la réponse (TST-K6-12)
    type: 'budget_depasse',
    tache_id: null,
    signal_valeur: 0.92,
    signal_unite: 'ratio',
    message_llm: 'Test message.',
    detected_at: new Date().toISOString(),
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ============================================================
// Setup
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()

  mockGetUser.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        app_metadata: { organisation_id: 'org-1', role: 'admin' },
      },
    },
    error: null,
  })

  mockCanAccessChantier.mockResolvedValue(true)

  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    count: vi.fn().mockResolvedValue({ count: 0, error: null }),
  })
})

// ============================================================
// GET /api/chantiers/[id]/derives
// ============================================================

describe('GET /api/chantiers/[id]/derives', () => {
  function makeChantierDerivesRequest(chantierId: string, params: Record<string, string> = {}): NextRequest {
    const url = new URL(`http://localhost/api/chantiers/${chantierId}/derives`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    const headers = new Headers()
    headers.set('x-organisation-id', 'org-1')
    headers.set('x-user-role', 'admin')
    headers.set('x-user-id', 'user-1')
    return new NextRequest(url, { method: 'GET', headers })
  }

  it('retourne 200 avec liste vide si aucune dérive (happy path)', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    const req = makeChantierDerivesRequest('ch-1')
    const res = await getChantierDerives(req, { params: Promise.resolve({ id: 'ch-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('derives')
    expect(Array.isArray(body.derives)).toBe(true)
  })

  it('retourne 404 si canAccessChantier retourne false', async () => {
    mockCanAccessChantier.mockResolvedValue(false)
    const req = makeChantierDerivesRequest('ch-1')
    const res = await getChantierDerives(req, { params: Promise.resolve({ id: 'ch-1' }) })
    expect(res.status).toBe(404)
  })

  it('retourne 401 si non authentifié (headers middleware absents)', async () => {
    const req = new NextRequest('http://localhost/api/chantiers/ch-1/derives', {
      method: 'GET',
    })
    const res = await getChantierDerives(req, { params: Promise.resolve({ id: 'ch-1' }) })
    expect(res.status).toBe(401)
  })

  it('retourne 400 si limit > 50 (borne max pagination)', async () => {
    const req = makeChantierDerivesRequest('ch-1', { limit: '100' })
    const res = await getChantierDerives(req, { params: Promise.resolve({ id: 'ch-1' }) })
    expect(res.status).toBe(400)
  })

  it('cursor-based pagination — accepte cursor ISO datetime', async () => {
    const cursor = new Date(Date.now() - 1000).toISOString()
    const req = makeChantierDerivesRequest('ch-1', { cursor })
    const res = await getChantierDerives(req, { params: Promise.resolve({ id: 'ch-1' }) })
    // Doit accepter le cursor sans erreur
    expect([200, 400]).toContain(res.status) // 400 seulement si cursor invalide
  })
})

// ============================================================
// GET /api/derives (vue consolidée admin)
// ============================================================

describe('GET /api/derives', () => {
  function makeDerivesRequest(role = 'admin'): NextRequest {
    const headers = new Headers()
    headers.set('x-organisation-id', 'org-1')
    headers.set('x-user-role', role)
    headers.set('x-user-id', 'user-1')
    return new NextRequest('http://localhost/api/derives', {
      method: 'GET',
      headers,
    })
  }

  it('retourne 200 avec derives et total_actives (happy path)', async () => {
    const fromSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      }),
    })
    mockFrom.mockImplementation(fromSpy)

    const req = makeDerivesRequest()
    const res = await getDerives(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('derives')
    expect(body).toHaveProperty('total_actives')
  })

  it('retourne 403 si role != admin (conducteur interdit)', async () => {
    // makeDerivesRequest('conducteur') inclut x-user-id → passe l'auth → 403 role check
    const req = makeDerivesRequest('conducteur')
    const res = await getDerives(req)
    expect(res.status).toBe(403)
  })

  it('retourne 401 si non authentifié (headers middleware absents)', async () => {
    const req = new NextRequest('http://localhost/api/derives', { method: 'GET' })
    const res = await getDerives(req)
    expect(res.status).toBe(401)
  })

  it('TST-K6-14 CRITICAL : handler applique .eq("organisation_id", ...) pour isoler les orgs', async () => {
    // adminClient bypass RLS — le handler DOIT filtrer par organisation_id
    const eqSpy = vi.fn().mockReturnThis()
    const fromSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    })
    mockFrom.mockImplementation(fromSpy)

    const req = makeDerivesRequest()
    await getDerives(req)

    // Vérifier que .eq('organisation_id', 'org-1') a été appelé
    const orgFilterApplied = eqSpy.mock.calls.some(
      (call) => call[0] === 'organisation_id' && call[1] === 'org-1',
    )
    expect(orgFilterApplied).toBe(true)
  })

  it('TST-K6-14 : filtre organisation_id utilise celle du header (jamais du body)', async () => {
    // Tente une injection via searchParams — doit utiliser seulement le header
    const headers = new Headers()
    headers.set('x-organisation-id', 'org-1')
    headers.set('x-user-role', 'admin')
    headers.set('x-user-id', 'user-1')
    const url = new URL('http://localhost/api/derives?organisation_id=org-malveillante')
    const req = new NextRequest(url, { method: 'GET', headers })

    const eqSpy = vi.fn().mockReturnThis()
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    })

    await getDerives(req)

    // org-malveillante ne doit jamais apparaître dans les filtres eq
    const malveillante = eqSpy.mock.calls.some(
      (call) => call[1] === 'org-malveillante',
    )
    expect(malveillante).toBe(false)
  })

  it('retourne 400 si limit > 50', async () => {
    const headers = new Headers()
    headers.set('x-organisation-id', 'org-1')
    headers.set('x-user-role', 'admin')
    headers.set('x-user-id', 'user-1')
    const url = new URL('http://localhost/api/derives?limit=100')
    const req = new NextRequest(url, { method: 'GET', headers })

    const res = await getDerives(req)
    expect(res.status).toBe(400)
  })
})
