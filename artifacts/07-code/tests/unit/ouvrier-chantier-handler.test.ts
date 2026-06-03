/**
 * tests/unit/ouvrier-chantier-handler.test.ts
 * Tests integration GET /api/ouvrier/chantiers/[id] — vue moyenne
 *
 * Scenarios couverts (TST-K3-08 a 12) :
 *   TST-K3-08 : reponse ne contient pas note_privee_conducteur (D4 specs DoD — K3-CR-02)
 *   TST-K3-09 : description_courte ≤ 120 chars pour taches non-siennes (D-3-025)
 *   TST-K3-10 : description_complete pleine pour taches is_mine=true
 *   TST-K3-11 : IDOR chantier non affecte → 403 (K3-CR-03)
 *   TST-K3-12 : photos tache is_mine=false → pas de cle `photos` dans payload
 *   Bonus : sans session → 401
 *   Bonus : table photos absente (42P01) → photos: [] sans crash (D-3-024)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockGetOuvrierSession = vi.fn()
const mockAdminFrom = vi.fn()

vi.mock('../../lib/ouvrier-session', () => ({
  getOuvrierSession: (...args: unknown[]) => mockGetOuvrierSession(...args),
  OUVRIER_SESSION_TTL: 604800,
  SESSION_PREFIX: 'ouvrier_session:',
  USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
  // Aliases backward-compat
  REDIS_SESSION_PREFIX: 'ouvrier_session:',
  REDIS_USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
}))

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
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

const VALID_SESSION = {
  user_id: '00000000-0000-0000-0000-000000000001',
  organisation_id: '00000000-0000-0000-0000-000000000002',
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

const VALID_CHANTIER = {
  id: '00000000-0000-0000-0000-000000000020',
  nom: 'Chantier Test',
  client_nom: 'Client A',
  adresse: '1 rue de la Paix',
  code_postal: '75001',
  statut: 'actif',
  date_debut: '2026-01-01',
  date_fin_prevue: '2026-12-31',
  created_by: '00000000-0000-0000-0000-000000000099',
}

const DESCRIPTION_LONG = 'a'.repeat(200) // 200 chars > 120

function makeTache(
  id: string,
  assignedTo: string | null,
  extraFields?: Record<string, unknown>,
) {
  return {
    id,
    titre: 'Tache test',
    statut: 'a_faire',
    description: DESCRIPTION_LONG,
    bloque_raison: null,
    assigned_to: assignedTo,
    date_echeance: null,
    created_at: '2026-01-01T00:00:00Z',
    // note_privee_conducteur JAMAIS dans cette liste — defense niveau 1 SELECT explicite
    ...extraFields,
  }
}

function buildRequest(chantierId: string): NextRequest {
  return new NextRequest(`http://localhost/api/ouvrier/chantiers/${chantierId}`)
}

// ============================================================
// Setup multi-appels adminFrom
// ============================================================

function setupAdminMocks({
  affectationCount = 1,
  taches = [] as ReturnType<typeof makeTache>[],
  photosError = null as { code?: string; message: string } | null,
  photosData = [] as unknown[],
} = {}) {
  let callIndex = 0

  mockAdminFrom.mockImplementation((tableName: string) => {
    callIndex++

    if (tableName === 'affectations' && callIndex === 1) {
      // RBAC check affectation (hard delete pattern — no deleted_at filter)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({
                  limit: () => Promise.resolve({
                    data: affectationCount > 0 ? [{ id: 'aff-id' }] : [],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    }

    if (tableName === 'chantiers') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: VALID_CHANTIER, error: null }),
            }),
          }),
        }),
      }
    }

    if (tableName === 'taches') {
      // hard delete pattern (CASCADE) — no deleted_at filter
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: taches, error: null }),
          }),
        }),
      }
    }

    if (tableName === 'photos') {
      if (photosError) {
        return {
          select: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: null, error: photosError }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          in: () => ({
            order: () => Promise.resolve({ data: photosData, error: null }),
          }),
        }),
      }
    }

    // conducteur
    return {
      select: () => ({
        eq: () => ({
          is: () => ({
            single: () => Promise.resolve({
              data: { nom: 'Martin', prenom: 'Paul', telephone: '+33601020304' },
              error: null,
            }),
          }),
        }),
      }),
    }
  })
}

// ============================================================
// Tests
// ============================================================

describe('GET /api/ouvrier/chantiers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('Bonus : sans session → 401', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(null)

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const response = await GET(buildRequest('chantier-id'), {
      params: Promise.resolve({ id: 'chantier-id' }),
    })

    expect(response.status).toBe(401)
  })

  it('TST-K3-11 : IDOR chantier non affecte → 403', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupAdminMocks({ affectationCount: 0 }) // 0 affectation → 403

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const response = await GET(buildRequest('chantier-id'), {
      params: Promise.resolve({ id: 'chantier-id' }),
    })

    expect(response.status).toBe(403)
  })

  it('TST-K3-08 : note_privee_conducteur ABSENT de la reponse (D4 DoD — K3-CR-02)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheMienne = makeTache('t1', VALID_SESSION.user_id)
    setupAdminMocks({ taches: [tacheMienne] })

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const response = await GET(buildRequest('chantier-id'), {
      params: Promise.resolve({ id: 'chantier-id' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { taches: unknown[] }

    // D4 specs DoD : note_privee_conducteur JAMAIS dans la reponse ouvrier
    const responseText = JSON.stringify(body)
    expect(responseText).not.toContain('note_privee_conducteur')

    // Verifier au niveau objet aussi
    const tache = body.taches[0] as Record<string, unknown>
    expect(tache).not.toHaveProperty('note_privee_conducteur')
  })

  it('TST-K3-09 : description_courte ≤ 120 chars pour taches non-siennes (D-3-025)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheAutre = makeTache('t1', 'autre-user-id') // pas mienne
    setupAdminMocks({ taches: [tacheAutre] })

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const response = await GET(buildRequest('chantier-id'), {
      params: Promise.resolve({ id: 'chantier-id' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { taches: Array<Record<string, unknown>> }
    const tache = body.taches[0]

    expect(tache['is_mine']).toBe(false)
    const courte = tache['description_courte'] as string | null
    if (courte !== null) {
      expect(courte.length).toBeLessThanOrEqual(120)
    }
    // description_complete ne doit PAS etre presente pour une tache non-mienne
    expect(tache).not.toHaveProperty('description_complete')
  })

  it('TST-K3-10 : description_complete pleine pour taches is_mine=true', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheMienne = makeTache('t1', VALID_SESSION.user_id)
    setupAdminMocks({ taches: [tacheMienne] })

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const response = await GET(buildRequest('chantier-id'), {
      params: Promise.resolve({ id: 'chantier-id' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { taches: Array<Record<string, unknown>> }
    const tache = body.taches[0]

    expect(tache['is_mine']).toBe(true)
    // description_complete doit etre la valeur complete (200 chars)
    const complete = tache['description_complete'] as string | null
    expect(complete).toBe(DESCRIPTION_LONG)
    expect(complete?.length).toBe(200)
  })

  it('TST-K3-12 : photos absentes pour tache is_mine=false', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheAutre = makeTache('t1', 'autre-user-id')
    setupAdminMocks({ taches: [tacheAutre] })

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const response = await GET(buildRequest('chantier-id'), {
      params: Promise.resolve({ id: 'chantier-id' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { taches: Array<Record<string, unknown>> }
    const tache = body.taches[0]

    expect(tache['is_mine']).toBe(false)
    // D-3-024 : photos (tableau URLs) absent pour les taches non-siennes
    expect(tache).not.toHaveProperty('photos')
    // photos_count present mais = 0 (pas de charge pour non-mine)
    expect(tache['photos_count']).toBe(0)
  })

  it('Bonus D-3-024 : table photos absente (42P01) → photos: [] sans crash', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheMienne = makeTache('t1', VALID_SESSION.user_id)
    setupAdminMocks({
      taches: [tacheMienne],
      photosError: { code: '42P01', message: 'relation "photos" does not exist' },
    })

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const response = await GET(buildRequest('chantier-id'), {
      params: Promise.resolve({ id: 'chantier-id' }),
    })

    // Doit retourner 200, pas 500 (D-3-024 try/catch 42P01)
    expect(response.status).toBe(200)
    const body = await response.json() as { taches: Array<Record<string, unknown>> }
    const tache = body.taches[0]

    expect(tache['is_mine']).toBe(true)
    expect(tache['photos']).toEqual([])
    expect(tache['photos_count']).toBe(0)
  })
})
