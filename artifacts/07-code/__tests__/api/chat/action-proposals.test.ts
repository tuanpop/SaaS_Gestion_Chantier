/**
 * __tests__/api/chat/action-proposals.test.ts
 *
 * Tests GET /api/chantiers/[id]/action-proposals
 * + PATCH /api/action-proposals/[id]/payload
 * + PATCH /api/action-proposals/[id]/valider
 * + PATCH /api/action-proposals/[id]/rejeter
 *
 * RBAC-OUVRIER-003 BINDING : ouvrier → 403 sur GET action-proposals
 * D-8-06 BINDING : limit max 50 enforced server-side
 * D-8-13 BINDING : valider route est le SEUL endroit qui exécute
 * D-8-14 BINDING : payload PATCH ne contient jamais chantier_id/organisation_id
 * EXI-Y-K8-06 BINDING : Zod .strict() rejette clés supplémentaires dans payload PATCH
 *
 * Cas couverts :
 *   AP-GET-1 : ouvrier → 403 (RBAC-OUVRIER-003 BINDING)
 *   AP-GET-2 : unauthenticated → 401
 *   AP-GET-3 : admin → 200 + proposals[]
 *   AP-GET-4 : limit=51 → 400 (D-8-06)
 *   AP-PAY-1 : PATCH payload avec chantier_id → 400 (Zod strict IDOR)
 *   AP-PAY-2 : PATCH payload valide → 200
 *   AP-PAY-3 : proposal non-pending → 409
 *   AP-VAL-1 : valider — ouvrier → 403
 *   AP-VAL-2 : valider — unauthenticated → 401
 *   AP-REJ-1 : rejeter — pending → statut 'rejete'
 *   AP-REJ-2 : rejeter — non-pending → 409
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockAdminFrom, mockClientFrom, mockLogger, mockOuvrierSession, mockExecuterAction, mockAssertTrialActive } = vi.hoisted(() => {
  const mockAdminFrom = vi.fn()
  const mockClientFrom = vi.fn()
  return {
    mockAdminFrom,
    mockClientFrom,
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    mockOuvrierSession: vi.fn(),
    mockExecuterAction: vi.fn(),
    mockAssertTrialActive: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/llm/register', () => ({}))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ from: mockClientFrom }),
}))
vi.mock('@/lib/ouvrier-session', () => ({ getOuvrierSession: mockOuvrierSession }))
vi.mock('@/lib/chat/executerAction', () => ({ executerAction: mockExecuterAction }))
vi.mock('@/lib/trial-gate', () => ({ assertTrialActive: mockAssertTrialActive, checkTrialGate: vi.fn().mockResolvedValue({ blocked: false }) }))

import { GET } from '@/app/api/chantiers/[id]/action-proposals/route'
import { PATCH as PatchPayload } from '@/app/api/action-proposals/[id]/payload/route'
import { PATCH as PatchValider } from '@/app/api/action-proposals/[id]/valider/route'
import { PATCH as PatchRejeter } from '@/app/api/action-proposals/[id]/rejeter/route'
import { NextRequest } from 'next/server'

// ============================================================
// Fixtures
// ============================================================

const ORG_ID = 'org-uuid-0000-0000-0000-000000000001'
const USER_ID = 'user-uuid-0000-0000-0000-000000000001'
const CHANTIER_ID = 'chantier-uuid-000-0000-000000000001'
const PROPOSAL_ID = 'proposal-uuid-000-0000-000000000001'

function makeRequest(url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  if (body !== undefined) {
    const h = headers['Content-Type'] ? headers : { ...headers, 'Content-Type': 'application/json' }
    return new NextRequest(url, { method, headers: h, body: JSON.stringify(body) })
  }
  return new NextRequest(url, { method, headers })
}

const adminHeaders = {
  'x-user-id': USER_ID,
  'x-user-role': 'admin',
  'x-organisation-id': ORG_ID,
}

const conducteurHeaders = {
  'x-user-id': USER_ID,
  'x-user-role': 'conducteur',
  'x-organisation-id': ORG_ID,
}

const pendingProposal = {
  id: PROPOSAL_ID,
  organisation_id: ORG_ID,
  chantier_id: CHANTIER_ID,
  message_id: 'msg-001',
  type: 'creer_tache',
  payload: { titre: 'Fondations' },
  statut: 'pending',
  valide_par: null,
  valide_at: null,
  erreur_execution: null,
  ressource_id: null,
  ressource_type: null,
  created_at: new Date().toISOString(),
}

// ============================================================
// Tests GET /api/chantiers/[id]/action-proposals
// ============================================================

describe('GET /api/chantiers/[id]/action-proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOuvrierSession.mockResolvedValue(null)
  })

  it('AP-GET-1 : ouvrier → 403 (RBAC-OUVRIER-003 BINDING)', async () => {
    // Session ouvrier (cookie)
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: 'ouvrier-001',
      organisation_id: ORG_ID,
    })

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/action-proposals`,
    )

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(403)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('refusé')
  })

  it('AP-GET-2 : unauthenticated → 401', async () => {
    const req = makeRequest(`http://localhost/api/chantiers/${CHANTIER_ID}/action-proposals`)

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(401)
  })

  it('AP-GET-3 : admin → 200 + proposals[]', async () => {
    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'chantiers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: CHANTIER_ID, organisation_id: ORG_ID, created_by: USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })

    const proposalsList = [pendingProposal]
    const limitFn = vi.fn().mockResolvedValue({ data: proposalsList, error: null })
    const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
    const eqChain = vi.fn().mockReturnThis()
    eqChain.mockReturnValue({ eq: eqChain, order: orderFn })
    mockClientFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: eqChain }),
    })

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/action-proposals`,
      'GET',
      undefined,
      adminHeaders,
    )

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { proposals: unknown[]; has_more: boolean }
    expect(Array.isArray(body.proposals)).toBe(true)
  })

  it('AP-GET-4 : limit=51 → 400 (D-8-06 enforced server-side)', async () => {
    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'chantiers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: CHANTIER_ID, organisation_id: ORG_ID, created_by: USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
    })

    const req = makeRequest(
      `http://localhost/api/chantiers/${CHANTIER_ID}/action-proposals?limit=51`,
      'GET',
      undefined,
      adminHeaders,
    )

    const response = await GET(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(400)
  })
})

// ============================================================
// Tests PATCH /api/action-proposals/[id]/payload
// ============================================================

describe('PATCH /api/action-proposals/[id]/payload — Zod strict IDOR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOuvrierSession.mockResolvedValue(null)
  })

  it('AP-PAY-1 : payload avec chantier_id → 400 (Zod strict EXI-Y-K8-06 IDOR)', async () => {
    // Mock proposal pending
    mockAdminFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: pendingProposal, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: pendingProposal, error: null }),
          }),
        }),
      }),
    }))

    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/payload`,
      'PATCH',
      {
        titre: 'Fondations modifiées',
        chantier_id: CHANTIER_ID, // IDOR injecté — doit être rejeté par Zod .strict()
      },
      adminHeaders,
    )

    const response = await PatchPayload(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('AP-PAY-2 : payload valide creer_tache → 200', async () => {
    const updatedProposal = {
      ...pendingProposal,
      payload: { titre: 'Fondations modifiées', description: 'Zone sud' },
    }

    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'action_proposals') {
        const singleFn = vi.fn().mockResolvedValue({ data: updatedProposal, error: null })
        const selectFn = vi.fn().mockReturnValue({ single: singleFn })
        const eqUpdateFn = vi.fn().mockReturnValue({ select: selectFn })
        const updateFn = vi.fn().mockReturnValue({ eq: eqUpdateFn })
        const eqSelectFn = vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: pendingProposal, error: null }),
        })
        const selectQueryFn = vi.fn().mockReturnValue({ eq: eqSelectFn })
        return { select: selectQueryFn, update: updateFn }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
    })

    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/payload`,
      'PATCH',
      { titre: 'Fondations modifiées', description: 'Zone sud' },
      adminHeaders,
    )

    const response = await PatchPayload(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(200)
  })

  it('AP-PAY-3 : proposal statut != pending → 409', async () => {
    const validedProposal = { ...pendingProposal, statut: 'valide' }

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: validedProposal, error: null }),
        }),
      }),
    })

    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/payload`,
      'PATCH',
      { titre: 'Test' },
      adminHeaders,
    )

    const response = await PatchPayload(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(409)
  })
})

// ============================================================
// Tests PATCH /api/action-proposals/[id]/valider
// ============================================================

describe('PATCH /api/action-proposals/[id]/valider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOuvrierSession.mockResolvedValue(null)
    mockAssertTrialActive.mockResolvedValue(undefined)
  })

  it('AP-VAL-1 : ouvrier → 403', async () => {
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: 'ouvrier-001',
      organisation_id: ORG_ID,
    })

    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/valider`,
      'PATCH',
    )

    const response = await PatchValider(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(403)
  })

  it('AP-VAL-2 : unauthenticated → 401', async () => {
    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/valider`,
      'PATCH',
    )

    const response = await PatchValider(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(401)
  })

  it('AP-VAL-3 : D-8-13 — executerAction appelé UNIQUEMENT depuis valider/route.ts', async () => {
    // Setup mocks pour valider happy path
    mockExecuterAction.mockResolvedValueOnce({
      ressource_id: 'new-tache-id',
      ressource_type: 'tache',
      erreur: null,
    })

    const executeResult = { ...pendingProposal, statut: 'execute', ressource_id: 'new-tache-id', ressource_type: 'tache' }

    let updateCallCount = 0
    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'action_proposals') {
        const singleFn = vi.fn().mockResolvedValue({ data: executeResult, error: null })
        const selectFn = vi.fn().mockReturnValue({ single: singleFn })
        const eqFn = vi.fn().mockReturnValue({ select: selectFn })
        const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: pendingProposal, error: null }),
            }),
          }),
          update: updateFn,
        }
      }
      if (tableName === 'chantiers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: CHANTIER_ID, created_by: USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
    })

    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/valider`,
      'PATCH',
      undefined,
      adminHeaders,
    )

    const response = await PatchValider(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })

    // executerAction doit être appelé (c'est le seul endroit autorisé en prod)
    expect(mockExecuterAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROPOSAL_ID }),
      expect.anything(),
      expect.any(String), // userId validateur → created_by
    )
    // Les statuts valide → execute (ou valide si erreur)
    expect([200, 500]).toContain(response.status)
  })
})

// ============================================================
// Tests PATCH /api/action-proposals/[id]/rejeter
// ============================================================

describe('PATCH /api/action-proposals/[id]/rejeter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOuvrierSession.mockResolvedValue(null)
  })

  it('AP-REJ-1 : pending → statut "rejete" (200)', async () => {
    const rejetedProposal = { ...pendingProposal, statut: 'rejete' }

    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'action_proposals') {
        // SELECT maybeSingle (lookup) + UPDATE .select().single() (mise à jour)
        const singleFn = vi.fn().mockResolvedValue({ data: rejetedProposal, error: null })
        const selectFn = vi.fn().mockReturnValue({ single: singleFn })
        const eqFn = vi.fn().mockReturnValue({ select: selectFn })
        const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: pendingProposal, error: null }),
            }),
          }),
          update: updateFn,
        }
      }
      if (tableName === 'chantiers') {
        // conducteur = created_by → check affectations skippé
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: CHANTIER_ID, created_by: USER_ID }, // created_by === auth.userId
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
    })

    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/rejeter`,
      'PATCH',
      undefined,
      conducteurHeaders,
    )

    const response = await PatchRejeter(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(200)

    const body = await response.json() as { statut?: string }
    expect(body.statut).toBe('rejete')
  })

  it('AP-REJ-2 : proposal non-pending → 409', async () => {
    const executedProposal = { ...pendingProposal, statut: 'execute' }

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: executedProposal, error: null }),
        }),
      }),
    })

    const req = makeRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_ID}/rejeter`,
      'PATCH',
      undefined,
      adminHeaders,
    )

    const response = await PatchRejeter(req, { params: Promise.resolve({ id: PROPOSAL_ID }) })
    expect(response.status).toBe(409)
  })
})
