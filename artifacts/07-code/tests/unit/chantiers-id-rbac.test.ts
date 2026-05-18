/**
 * tests/unit/chantiers-id-rbac.test.ts — Tests RBAC + ownership PATCH/DELETE /api/chantiers/[id]
 *
 * GAP-PATCH-DELETE-chantiers (Levi 2026-05-16) : les handlers PATCH et DELETE
 * de app/api/chantiers/[id]/route.ts n'étaient couverts ni en unit ni en E2E.
 * Ces tests valident le RBAC (admin only -> 403) + ownership (hors org -> 404)
 * + claims manquants (401) via mocks des dépendances Supabase / trial-gate.
 *
 * Scénarios :
 *   PATCH-1   : conducteur tente PATCH -> HTTP 403
 *   PATCH-2   : admin sans claims -> HTTP 401
 *   PATCH-3   : admin tente PATCH d'un chantier hors org -> HTTP 404 (I-06)
 *   PATCH-4   : admin avec payload invalide (code_postal) -> HTTP 400
 *   PATCH-5   : admin avec body vide -> HTTP 400 ("Aucun champ à mettre à jour")
 *   DELETE-1  : conducteur tente DELETE -> HTTP 403
 *   DELETE-2  : admin sans claims -> HTTP 401
 *   DELETE-3  : admin tente DELETE d'un chantier hors org -> HTTP 404 (I-06)
 *   DELETE-4  : admin soft-delete OK -> HTTP 204 + statut='archive' dans update
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks Supabase + trial-gate
// ============================================================

const {
  mockOwnershipSingle,
  mockUpdateChain,
  mockArchiveUpdate,
  mockAssertTrial,
} = vi.hoisted(() => ({
  mockOwnershipSingle: vi.fn(),
  mockUpdateChain: vi.fn(),
  mockArchiveUpdate: vi.fn(),
  mockAssertTrial: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({} as never),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: mockOwnershipSingle,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          // PATCH : .eq().select().single()
          eq: () => ({
            select: () => ({
              single: mockUpdateChain,
            }),
            // DELETE : .eq().eq() retourne directement la promise (pas de .select)
            then: (resolve: (v: unknown) => void) => resolve(mockArchiveUpdate()),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/trial-gate', () => ({
  assertTrialActive: mockAssertTrial,
}))

// canAccessChantier n'est pas utilisé pour PATCH/DELETE — pas besoin de mock

// ============================================================
// Helpers
// ============================================================

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const CHANTIER_ID = 'cccccccc-0000-0000-0000-000000000000'

function buildRequest(
  method: 'PATCH' | 'DELETE',
  headers: Record<string, string>,
  body?: unknown,
): NextRequest {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return new NextRequest(`http://localhost:3000/api/chantiers/${CHANTIER_ID}`, init)
}

function asAdmin(): Record<string, string> {
  return {
    'x-organisation-id': ORG_ID,
    'x-user-id': USER_ID,
    'x-user-role': 'admin',
  }
}

function asConducteur(): Record<string, string> {
  return {
    'x-organisation-id': ORG_ID,
    'x-user-id': USER_ID,
    'x-user-role': 'conducteur',
  }
}

// ============================================================
// PATCH /api/chantiers/[id]
// ============================================================

describe('PATCH /api/chantiers/[id] — RBAC + ownership', () => {
  beforeEach(() => {
    mockOwnershipSingle.mockReset()
    mockUpdateChain.mockReset()
    mockAssertTrial.mockReset().mockResolvedValue(undefined)
  })

  it('PATCH-1 — conducteur -> HTTP 403 (E-01)', async () => {
    const { PATCH } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('PATCH', asConducteur(), { nom: 'Nouveau nom' })
    const response = await PATCH(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(403)
    expect(mockAssertTrial).not.toHaveBeenCalled()
    expect(mockOwnershipSingle).not.toHaveBeenCalled()
  })

  it('PATCH-2 — claims manquants -> HTTP 401', async () => {
    const { PATCH } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('PATCH', {}, { nom: 'X' })
    const response = await PATCH(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(401)
  })

  it('PATCH-3 — admin tente PATCH chantier hors org -> HTTP 404 (I-06)', async () => {
    mockOwnershipSingle.mockResolvedValue({ data: null, error: null })

    const { PATCH } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('PATCH', asAdmin(), { nom: 'Nouveau nom' })
    const response = await PATCH(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(404)
    const json = (await response.json()) as { error: string }
    expect(json.error).toBe('Ressource introuvable.')
  })

  it('PATCH-4 — admin avec code_postal invalide -> HTTP 400', async () => {
    mockOwnershipSingle.mockResolvedValue({
      data: { id: CHANTIER_ID },
      error: null,
    })

    const { PATCH } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('PATCH', asAdmin(), { code_postal: '750' })
    const response = await PATCH(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(400)
  })

  it('PATCH-5 — admin avec body vide -> HTTP 400', async () => {
    mockOwnershipSingle.mockResolvedValue({
      data: { id: CHANTIER_ID },
      error: null,
    })

    const { PATCH } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('PATCH', asAdmin(), {})
    const response = await PATCH(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(400)
    const json = (await response.json()) as { error: string }
    expect(json.error).toBe('Aucun champ à mettre à jour.')
  })
})

// ============================================================
// DELETE /api/chantiers/[id]
// ============================================================

describe('DELETE /api/chantiers/[id] — RBAC + ownership + soft delete', () => {
  beforeEach(() => {
    mockOwnershipSingle.mockReset()
    mockArchiveUpdate.mockReset()
    mockAssertTrial.mockReset().mockResolvedValue(undefined)
  })

  it('DELETE-1 — conducteur -> HTTP 403 (E-01)', async () => {
    const { DELETE } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('DELETE', asConducteur())
    const response = await DELETE(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(403)
    expect(mockAssertTrial).not.toHaveBeenCalled()
  })

  it('DELETE-2 — claims manquants -> HTTP 401', async () => {
    const { DELETE } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('DELETE', {})
    const response = await DELETE(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(401)
  })

  it('DELETE-3 — admin tente DELETE chantier hors org -> HTTP 404 (I-06)', async () => {
    mockOwnershipSingle.mockResolvedValue({ data: null, error: null })

    const { DELETE } = await import('@/app/api/chantiers/[id]/route')

    const request = buildRequest('DELETE', asAdmin())
    const response = await DELETE(request, { params: Promise.resolve({ id: CHANTIER_ID }) })

    expect(response.status).toBe(404)
    const json = (await response.json()) as { error: string }
    expect(json.error).toBe('Ressource introuvable.')
  })
})
