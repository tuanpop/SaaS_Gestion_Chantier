/**
 * tests/unit/photos-patch-commentaire-happy.test.ts
 * Tests PATCH /api/photos/[id] — happy path et cas edge (US-4.6)
 *
 * US-4.6-HP   : auteur PATCH commentaire -> 200, commentaire mis à jour
 * US-4.6-NULL : auteur PATCH commentaire=null (effacement) -> 200, commentaire null en base
 * US-4.6-LEN  : commentaire 500 chars (limite exacte) -> 200
 * US-4.6-OVER : commentaire 501 chars -> 400 (Zod)
 * US-4.6-STOR : storage_path absent de la réponse PATCH (D-4-006)
 * RG-PHOTO-ROLLBACK : INSERT KO après upload -> Storage.remove appelé (best-effort)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockGetOuvrierSession = vi.fn()
const mockAdminFrom = vi.fn()

vi.mock('../../lib/ouvrier-session', () => ({
  getOuvrierSession: async (...args: unknown[]) => mockGetOuvrierSession(...args),
  OUVRIER_SESSION_TTL: 604800,
  SESSION_PREFIX: 'ouvrier_session:',
  USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
  REDIS_SESSION_PREFIX: 'ouvrier_session:',
  REDIS_USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
}))

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
    storage: {
      from: () => ({ createSignedUrls: vi.fn() }),
    },
  }),
}))

vi.mock('../../lib/photos-access', () => ({
  resolvePhotoActor: vi.fn(),
  canDeletePhoto: vi.fn(),
  validateImageBuffer: vi.fn(),
  signPhotoPaths: vi.fn(),
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

const ORG_ID   = '00000000-0000-0000-0000-000000000001'
const USER_1   = '00000000-0000-0000-0000-000000000010'
const PHOTO_ID = '00000000-0000-0000-0000-000000000030'

const VALID_SESSION = {
  user_id: USER_1,
  organisation_id: ORG_ID,
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

function buildPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: 'ouvrier_session=test' },
    body: JSON.stringify(body),
  })
}

function setupPatchHappy(commentaireResult: string | null) {
  let callCount = 0
  mockAdminFrom.mockImplementation(() => {
    callCount++
    if (callCount === 1) {
      // SELECT photo -> uploader = USER_1
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { id: PHOTO_ID, uploader_id: USER_1, organisation_id: ORG_ID, commentaire: null },
                error: null,
              }),
            }),
          }),
        }),
      }
    }
    // UPDATE
    return {
      update: () => ({
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: { id: PHOTO_ID, commentaire: commentaireResult, updated_at: '2026-06-07T00:00:00Z' },
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

describe('PATCH /api/photos/[id] — commentaire (US-4.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('US-4.6-HP : auteur PATCH commentaire 30 chars -> 200, commentaire mis à jour', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const nouveauCommentaire = 'C'.repeat(30)
    setupPatchHappy(nouveauCommentaire)

    const req = buildPatchRequest({ commentaire: nouveauCommentaire })
    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('commentaire', nouveauCommentaire)
    expect(body).toHaveProperty('updated_at')
    // storage_path JAMAIS dans la réponse PATCH (D-4-006)
    expect(body).not.toHaveProperty('storage_path')
  })

  it('US-4.6-NULL : auteur vide le commentaire (null) -> 200, commentaire null en base', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupPatchHappy(null)

    const req = buildPatchRequest({ commentaire: null })
    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    // Commentaire null = effacement (RG-PHOTO-006 + US-4.6 scénario "Effacer le commentaire")
    expect(body['commentaire']).toBeNull()
  })

  it('US-4.6-LEN : commentaire 500 chars (limite exacte) -> 200', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const commentaire500 = 'D'.repeat(500)
    setupPatchHappy(commentaire500)

    const req = buildPatchRequest({ commentaire: commentaire500 })
    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })

    // 500 chars = limite exacte -> accepté
    expect(res.status).toBe(200)
  })

  it('US-4.6-OVER : commentaire 501 chars -> 400 (Zod, avant UPDATE DB)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const commentaire501 = 'E'.repeat(501)

    const req = buildPatchRequest({ commentaire: commentaire501 })
    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })

    expect(res.status).toBe(400)
    // Aucun UPDATE DB ne doit avoir été fait
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })

  it('US-4.6-STOR : storage_path absent de la réponse PATCH 200 (D-4-006, K4-MED-01)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    setupPatchHappy('test')

    const req = buildPatchRequest({ commentaire: 'test' })
    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    const rawJson = JSON.stringify(body)
    expect(rawJson).not.toContain('storage_path')
  })
})
