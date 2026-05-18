/**
 * tests/unit/chantiers-rbac.test.ts — Tests RBAC POST /api/chantiers
 *
 * GAP-conducteur-403-POST (Levi 2026-05-16) : la règle "seul l'admin peut créer
 * un chantier" est implémentée dans app/api/chantiers/route.ts:208 (role !== 'admin' -> 403)
 * mais aucun test ne la couvrait. Ce fichier comble le gap avec un vrai test du
 * handler POST en mockant les dépendances Supabase.
 *
 * Scénarios :
 *   1. POST avec role='conducteur' -> HTTP 403 (E-01)
 *   2. POST avec role='admin' + payload valide -> pas de 403 (la suite peut échouer
 *      sur le trial-gate ou la DB, c'est OK ; on vérifie uniquement la passage du RBAC)
 *   3. POST sans claims dans les headers -> HTTP 401
 *   4. POST avec role='admin' + payload invalide (code_postal pas 5 chiffres) -> HTTP 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks — éviter tout appel réel à Supabase / Redis / Resend
// ============================================================

const { mockAssertTrial, mockAdminInsertSingle } = vi.hoisted(() => ({
  mockAssertTrial: vi.fn(),
  mockAdminInsertSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({} as never),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: mockAdminInsertSingle,
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/trial-gate', () => ({
  assertTrialActive: mockAssertTrial,
}))

// ============================================================
// Tests
// ============================================================

const VALID_PAYLOAD = {
  nom: 'Chantier Pilote',
  client_nom: 'Client Test',
  adresse: '12 rue de la République',
  code_postal: '75001',
  date_debut: '2026-06-01',
  date_fin_prevue: '2026-12-31',
}

function buildRequest(headers: Record<string, string>, body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/chantiers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/chantiers — RBAC (E-01)', () => {
  beforeEach(() => {
    mockAssertTrial.mockReset()
    mockAssertTrial.mockResolvedValue(undefined)
    mockAdminInsertSingle.mockReset()
    mockAdminInsertSingle.mockResolvedValue({ data: null, error: null })
  })

  it('Scénario 1 — role=conducteur -> HTTP 403', async () => {
    const { POST } = await import('@/app/api/chantiers/route')

    const request = buildRequest(
      {
        'x-organisation-id': '11111111-1111-1111-1111-111111111111',
        'x-user-id': '22222222-2222-2222-2222-222222222222',
        'x-user-role': 'conducteur',
      },
      VALID_PAYLOAD,
    )

    const response = await POST(request)
    expect(response.status).toBe(403)
    const json = (await response.json()) as { error: string }
    expect(json.error).toBe('Accès refusé.')
    // Le trial-gate ne doit jamais être atteint si le rôle est refusé
    expect(mockAssertTrial).not.toHaveBeenCalled()
  })

  it('Scénario 1 bis — role=ouvrier -> HTTP 403 (même règle)', async () => {
    const { POST } = await import('@/app/api/chantiers/route')

    const request = buildRequest(
      {
        'x-organisation-id': '11111111-1111-1111-1111-111111111111',
        'x-user-id': '22222222-2222-2222-2222-222222222222',
        'x-user-role': 'ouvrier',
      },
      VALID_PAYLOAD,
    )

    const response = await POST(request)
    expect(response.status).toBe(403)
  })

  it('Scénario 2 — role=admin passe le check RBAC (trial-gate appelé)', async () => {
    const { POST } = await import('@/app/api/chantiers/route')

    const request = buildRequest(
      {
        'x-organisation-id': '11111111-1111-1111-1111-111111111111',
        'x-user-id': '22222222-2222-2222-2222-222222222222',
        'x-user-role': 'admin',
      },
      VALID_PAYLOAD,
    )

    const response = await POST(request)
    // Avec role=admin, le RBAC est OK. Le handler continue jusqu'à trial-gate (appelé)
    // puis insert (mocké null/null) -> 500. On ne valide pas l'output final,
    // uniquement que le RBAC n'a PAS retourné 403.
    expect(response.status).not.toBe(403)
    expect(mockAssertTrial).toHaveBeenCalledOnce()
  })

  it('Scénario 3 — sans claims dans les headers -> HTTP 401', async () => {
    const { POST } = await import('@/app/api/chantiers/route')

    const request = buildRequest({}, VALID_PAYLOAD)
    const response = await POST(request)
    expect(response.status).toBe(401)
    const json = (await response.json()) as { error: string }
    expect(json.error).toBe('Non authentifié.')
  })

  it('Scénario 4 — admin avec code_postal invalide -> HTTP 400 (pas 403)', async () => {
    const { POST } = await import('@/app/api/chantiers/route')

    const request = buildRequest(
      {
        'x-organisation-id': '11111111-1111-1111-1111-111111111111',
        'x-user-id': '22222222-2222-2222-2222-222222222222',
        'x-user-role': 'admin',
      },
      { ...VALID_PAYLOAD, code_postal: '750' }, // 3 chiffres au lieu de 5
    )

    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})
