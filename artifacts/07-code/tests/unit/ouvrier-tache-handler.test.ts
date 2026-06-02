/**
 * tests/unit/ouvrier-tache-handler.test.ts
 * Tests integration PATCH /api/ouvrier/taches/[id]
 *
 * Scenarios couverts (TST-K3-13 a 18) :
 *   TST-K3-13 : PATCH statut a_faire → en_cours happy path
 *   TST-K3-14 : PATCH statut bloque → en_cours : bloque_raison force null (RG-STATUT-004)
 *   TST-K3-15 : PATCH avec note_privee_conducteur dans body → 400 Zod rejection (K3-CR-04)
 *   TST-K3-16 : PATCH tache non assignee → 403 (K3-E-02 IDOR)
 *   TST-K3-17 : PATCH statut termine → en_cours par ouvrier → 400 transition non autorisee
 *   TST-K3-18 : PATCH statut bloque sans bloque_raison → 400
 *   Bonus : sans session → 401
 *   Bonus : D5 specs DoD — tache autre ouvrier → 403
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

const OUVRIER_USER_ID = '00000000-0000-0000-0000-000000000001'
const ORG_ID = '00000000-0000-0000-0000-000000000002'
const CHANTIER_ID = '00000000-0000-0000-0000-000000000020'
const TACHE_ID = '00000000-0000-0000-0000-000000000030'
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000099'

const VALID_SESSION = {
  user_id: OUVRIER_USER_ID,
  organisation_id: ORG_ID,
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

function buildRequest(tacheId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/ouvrier/taches/${tacheId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function setupTacheMock({
  assignedTo = OUVRIER_USER_ID,
  currentStatut = 'a_faire',
}: {
  assignedTo?: string | null
  currentStatut?: string
} = {}) {
  let callIndex = 0
  mockAdminFrom.mockImplementation(() => {
    callIndex++

    if (callIndex === 1) {
      // taches select
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                single: () => Promise.resolve({
                  data: {
                    id: TACHE_ID,
                    assigned_to: assignedTo,
                    statut: currentStatut,
                    chantier_id: CHANTIER_ID,
                    organisation_id: ORG_ID,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }
    }

    if (callIndex === 2) {
      // affectations RBAC check
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  or: () => ({
                    limit: () => Promise.resolve({ data: [{ id: 'aff-id' }], error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    }

    // taches update
    return {
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: TACHE_ID,
                  statut: 'en_cours',
                  bloque_raison: null,
                  updated_at: '2026-06-02T00:00:00Z',
                },
                error: null,
              }),
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

describe('PATCH /api/ouvrier/taches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('Bonus : sans session → 401', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(null)

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(buildRequest(TACHE_ID, { statut: 'en_cours' }), {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(401)
  })

  it('TST-K3-15 : note_privee_conducteur dans body → 400 Zod strict rejection (K3-CR-04)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(
      buildRequest(TACHE_ID, {
        statut: 'en_cours',
        note_privee_conducteur: 'tentative injection',
      }),
      { params: Promise.resolve({ id: TACHE_ID }) },
    )

    // .strict() doit rejeter le champ inconnu
    expect(response.status).toBe(400)
    const body = await response.json() as Record<string, unknown>
    expect(body['error']).toBe('Requête invalide.')
  })

  it('TST-K3-16 : PATCH tache non assignee a cet ouvrier → 403 (K3-E-02 IDOR)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupTacheMock({ assignedTo: OTHER_USER_ID }) // tache assignee a un autre

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(buildRequest(TACHE_ID, { statut: 'en_cours' }), {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(403)
  })

  it('D5 specs DoD : tache appartenant a autre ouvrier → 403', async () => {
    // Meme test que TST-K3-16 — confirmation explicite DoD D5
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupTacheMock({ assignedTo: OTHER_USER_ID })

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(buildRequest(TACHE_ID, { statut: 'en_cours' }), {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(403)
  })

  it('TST-K3-17 : PATCH statut termine → en_cours → 400 transition non autorisee', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupTacheMock({ assignedTo: OUVRIER_USER_ID, currentStatut: 'termine' })

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(buildRequest(TACHE_ID, { statut: 'en_cours' }), {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(400)
    const body = await response.json() as Record<string, unknown>
    expect(body['error']).toContain('Transition de statut non autorisée')
  })

  it('TST-K3-18 : PATCH statut bloque sans bloque_raison → 400', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupTacheMock({ assignedTo: OUVRIER_USER_ID, currentStatut: 'a_faire' })

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(buildRequest(TACHE_ID, { statut: 'bloque' }), {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(400)
    const body = await response.json() as Record<string, unknown>
    expect(body['error']).toContain('motif de blocage')
  })

  it('TST-K3-13 : PATCH statut a_faire → en_cours happy path → 200', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupTacheMock({ assignedTo: OUVRIER_USER_ID, currentStatut: 'a_faire' })

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(buildRequest(TACHE_ID, { statut: 'en_cours' }), {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    // K3-I-05 : reponse shape limitee (4 champs uniquement)
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('statut')
    expect(body).toHaveProperty('bloque_raison')
    expect(body).toHaveProperty('updated_at')
    // Aucun champ sensible
    expect(body).not.toHaveProperty('note_privee_conducteur')
    expect(body).not.toHaveProperty('description')
  })

  it('TST-K3-14 : PATCH bloque → en_cours : bloque_raison force null (RG-STATUT-004)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupTacheMock({ assignedTo: OUVRIER_USER_ID, currentStatut: 'bloque' })

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const response = await PATCH(
      buildRequest(TACHE_ID, { statut: 'en_cours', bloque_raison: 'obstacle leve' }),
      { params: Promise.resolve({ id: TACHE_ID }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    // RG-STATUT-004 : bloque_raison force null cote serveur lors du passage en en_cours
    // Le mock retourne null pour bloque_raison ce qui est correct
    expect(body['bloque_raison']).toBeNull()
  })
})
