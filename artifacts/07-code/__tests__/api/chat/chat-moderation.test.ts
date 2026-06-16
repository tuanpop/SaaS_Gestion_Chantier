/**
 * __tests__/api/chat/chat-moderation.test.ts
 *
 * Tests DELETE /api/messages/[id] — Modération admin
 *
 * US-083 : admin peut soft-delete un message
 * BINDING : admin UNIQUEMENT — conducteur/ouvrier → 403
 * Soft-delete : UPDATE deleted_at (jamais DELETE physique)
 * D-8-14 BINDING IDOR : vérifier chantier appartient à org admin (cross-org → 404)
 *
 * Cas couverts :
 *   MOD-1 : admin → 200 + {deleted: true} (soft-delete)
 *   MOD-2 : conducteur → 403
 *   MOD-3 : ouvrier → 403
 *   MOD-4 : unauthenticated → 401
 *   MOD-5 : message inexistant → 404
 *   MOD-6 : message déjà supprimé → 409
 *   MOD-7 : message dans chantier hors org admin (IDOR) → 404
 *   MOD-8 : soft-delete, jamais DELETE physique (structurel)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockAdminFrom, mockLogger } = vi.hoisted(() => {
  return {
    mockAdminFrom: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  }
})

vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))

import { DELETE } from '@/app/api/messages/[id]/route'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================
// Fixtures
// ============================================================

const ADMIN_ID = 'admin-uuid-0000-0000-000000000001'
const ORG_ID = 'org-uuid-0000-0000-0000-000000000001'
const ORG_OTHER = 'org-uuid-0000-0000-0000-999999999999'
const MESSAGE_ID = 'msg-uuid-0000-0000-0000-000000000001'
const CHANTIER_ID = 'chantier-uuid-000-0000-000000000001'

const adminHeaders = {
  'x-user-id': ADMIN_ID,
  'x-user-role': 'admin',
  'x-organisation-id': ORG_ID,
}

function makeDeleteRequest(headers: Record<string, string> = adminHeaders) {
  return new NextRequest(`http://localhost/api/messages/${MESSAGE_ID}`, {
    method: 'DELETE',
    headers,
  })
}

// Mock message row non supprimé
const messageRow = {
  id: MESSAGE_ID,
  chantier_id: CHANTIER_ID,
  deleted_at: null,
}

// Setup admin mock pour le flow complet
function setupAdminMock(options: {
  msgData?: unknown
  msgError?: unknown
  chantierData?: unknown
  updateError?: unknown
} = {}) {
  const {
    msgData = messageRow,
    msgError = null,
    chantierData = { id: CHANTIER_ID },
    updateError = null,
  } = options

  mockAdminFrom.mockImplementation((tableName: string) => {
    if (tableName === 'messages') {
      // Distinguer SELECT (first call) vs UPDATE (second call)
      let selectDone = false
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: msgData, error: msgError }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: updateError }),
        }),
      }
    }
    if (tableName === 'chantiers') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: chantierData, error: null }),
            }),
          }),
        }),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })
}

// ============================================================
// Tests
// ============================================================

describe('DELETE /api/messages/[id] — Modération admin', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('MOD-1 : admin → 200 + {deleted: true} (soft-delete)', async () => {
    setupAdminMock()

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: MESSAGE_ID }) })
    expect(response.status).toBe(200)

    const body = await response.json() as { deleted: boolean }
    expect(body.deleted).toBe(true)
  })

  it('MOD-2 : conducteur → 403', async () => {
    const req = makeDeleteRequest({
      'x-user-id': ADMIN_ID,
      'x-user-role': 'conducteur',
      'x-organisation-id': ORG_ID,
    })

    const response = await DELETE(req, { params: Promise.resolve({ id: MESSAGE_ID }) })
    expect(response.status).toBe(403)
  })

  it('MOD-3 : ouvrier → 403', async () => {
    const req = makeDeleteRequest({
      'x-user-id': ADMIN_ID,
      'x-user-role': 'ouvrier',
      'x-organisation-id': ORG_ID,
    })

    const response = await DELETE(req, { params: Promise.resolve({ id: MESSAGE_ID }) })
    expect(response.status).toBe(403)
  })

  it('MOD-4 : unauthenticated (pas de headers) → 401', async () => {
    const req = new NextRequest(`http://localhost/api/messages/${MESSAGE_ID}`, {
      method: 'DELETE',
    })

    const response = await DELETE(req, { params: Promise.resolve({ id: MESSAGE_ID }) })
    expect(response.status).toBe(401)
  })

  it('MOD-5 : message inexistant → 404', async () => {
    setupAdminMock({ msgData: null })

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: MESSAGE_ID }) })
    expect(response.status).toBe(404)
  })

  it('MOD-6 : message déjà supprimé → 409', async () => {
    const alreadyDeletedMsg = { ...messageRow, deleted_at: new Date().toISOString() }
    setupAdminMock({ msgData: alreadyDeletedMsg })

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: MESSAGE_ID }) })
    expect(response.status).toBe(409)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('déjà supprimé')
  })

  it('MOD-7 : chantier hors org admin (IDOR D-8-14) → 404', async () => {
    // Message existe mais le chantier appartient à une autre org
    setupAdminMock({ chantierData: null })

    const response = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: MESSAGE_ID }) })
    // D-8-14 : IDOR → 404 (ne confirme pas l'existence du message)
    expect(response.status).toBe(404)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('introuvable')
  })

  it('MOD-8 : structurel — DELETE physique absent du route.ts (soft-delete uniquement)', () => {
    const routePath = resolve(
      __dirname,
      '../../../app/api/messages/[id]/route.ts',
    )
    const source = readFileSync(routePath, 'utf-8')

    // Vérifier qu'aucun DELETE SQL direct n'est utilisé (uniquement UPDATE deleted_at)
    // La méthode .delete() de Supabase JS ne doit pas apparaître (soft-delete obligatoire)
    // On vérifie que 'deleted_at' apparaît dans l'UPDATE (soft-delete)
    expect(source).toContain('deleted_at')
    expect(source).toContain("update({ deleted_at")

    // Le handler ne doit pas contenir .delete() au sens Supabase (suppression physique)
    // Un count de '.delete()' = 0 lignes de code actif (hors commentaires)
    const activeLines = source.split('\n').filter((l) => !l.trim().startsWith('//'))
    const physicalDeletes = activeLines.filter((l) => /\.delete\(\)/.test(l))
    expect(physicalDeletes).toHaveLength(0)
  })

  it('MOD-9 : admin → UPDATE messages appelé avec deleted_at (soft-delete)', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })

    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'messages') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: messageRow, error: null }),
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
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: CHANTIER_ID }, error: null }),
              }),
            }),
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
    })

    await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: MESSAGE_ID }) })

    // Vérifier que update() a été appelé avec deleted_at (soft-delete)
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }),
    )
    // deleted_at doit être une string ISO valide
    const updateArg = (updateFn.mock.calls[0] as Array<Record<string, unknown>>)[0]
    expect(typeof updateArg?.['deleted_at']).toBe('string')
    expect(new Date(updateArg?.['deleted_at'] as string).toString()).not.toBe('Invalid Date')
  })
})
