/**
 * tests/unit/photos-delete.test.ts
 * Tests DELETE /api/photos/[id] — TST-K4-07 a TST-K4-14
 *
 * TST-K4-07 : ouvrier auteur -> 204
 * TST-K4-08 : ouvrier non-auteur -> 403
 * TST-K4-09 : conducteur meme org -> 204
 * TST-K4-10 : conducteur autre org -> 404 (K4-MED-06 — ne revele pas l'existence)
 * TST-K4-11 : x-user-role: admin forge SANS JWT valide -> 401
 * TST-K4-12 : cookie ouvrier + x-user-role forge -> traite ouvrier (si auteur -> 204)
 * TST-K4-14 : Storage.remove KO (mock) -> 204 + ligne DB supprimee + warn log (best-effort)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockResolvePhotoActor = vi.fn()
const mockCanDeletePhoto = vi.fn()
const mockAdminFrom = vi.fn()
const mockStorageFrom = vi.fn()
const mockWarnLog = vi.fn()

vi.mock('../../lib/photos-access', () => ({
  resolvePhotoActor: async (...args: unknown[]) => mockResolvePhotoActor(...args),
  canDeletePhoto: (...args: unknown[]) => mockCanDeletePhoto(...args),
  validateImageBuffer: vi.fn(),
  signPhotoPaths: vi.fn(),
}))

vi.mock('../../lib/ouvrier-session', () => ({
  getOuvrierSession: vi.fn(),
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
      from: (...args: unknown[]) => mockStorageFrom(...args),
    },
  }),
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: mockWarnLog, error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({
      warn: mockWarnLog, error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    })),
  },
}))

// ============================================================
// Fixtures
// ============================================================

const ORG_A = '00000000-0000-0000-0000-000000000001'
const ORG_B = '00000000-0000-0000-0000-000000000002'
const USER_1 = '00000000-0000-0000-0000-000000000010'
const USER_2 = '00000000-0000-0000-0000-000000000011'
const PHOTO_ID = '00000000-0000-0000-0000-000000000030'

const PHOTO_ROW = {
  id: PHOTO_ID,
  uploader_id: USER_1,
  organisation_id: ORG_A,
  storage_path: `${ORG_A}/tache-1/${PHOTO_ID}.jpg`,
}

const ACTOR_OUVRIER_AUTEUR = {
  kind: 'ouvrier' as const,
  userId: USER_1,
  organisationId: ORG_A,
}

const ACTOR_OUVRIER_NON_AUTEUR = {
  kind: 'ouvrier' as const,
  userId: USER_2,
  organisationId: ORG_A,
}

const ACTOR_STAFF_MEME_ORG = {
  kind: 'staff' as const,
  userId: USER_2,
  organisationId: ORG_A,
  role: 'conducteur' as const,
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
    method: 'DELETE',
  })
}

function setupPhotoSelect(photo: typeof PHOTO_ROW | null = PHOTO_ROW) {
  mockAdminFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: photo, error: null }),
        }),
      }),
    }),
  })
}

function setupDeleteSuccess() {
  // Redefinir mockAdminFrom pour gerer la sequence SELECT + DELETE
  let selectCalled = false
  mockAdminFrom.mockImplementation(() => {
    if (!selectCalled) {
      selectCalled = true
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: PHOTO_ROW, error: null }),
            }),
          }),
        }),
      }
    }
    // DELETE
    return {
      delete: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }
  })
}

// ============================================================
// Tests
// ============================================================

describe('DELETE /api/photos/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('TST-K4-13 : sans acteur -> 401', async () => {
    mockResolvePhotoActor.mockResolvedValueOnce(null)

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(401)
  })

  it('TST-K4-07 : ouvrier auteur -> 204', async () => {
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_OUVRIER_AUTEUR)
    mockCanDeletePhoto.mockReturnValueOnce(true) // auteur OK
    setupDeleteSuccess()
    mockStorageFrom.mockReturnValue({
      remove: vi.fn().mockResolvedValue({ error: null }),
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(204)
  })

  it('TST-K4-08 : ouvrier non-auteur -> 403', async () => {
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_OUVRIER_NON_AUTEUR)
    mockCanDeletePhoto.mockReturnValueOnce(false) // non-auteur -> refus
    setupPhotoSelect(PHOTO_ROW)

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(403)
  })

  it('TST-K4-09 : conducteur meme org -> 204', async () => {
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_STAFF_MEME_ORG)
    mockCanDeletePhoto.mockReturnValueOnce(true) // meme org -> OK
    setupDeleteSuccess()
    mockStorageFrom.mockReturnValue({
      remove: vi.fn().mockResolvedValue({ error: null }),
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(204)
  })

  it('TST-K4-10 : conducteur autre org -> 404 (K4-MED-06)', async () => {
    const actorAutreOrg = { ...ACTOR_STAFF_MEME_ORG, organisationId: ORG_B }
    mockResolvePhotoActor.mockResolvedValueOnce(actorAutreOrg)
    // SELECT filtre par actor.organisationId -> photo non trouvee (cross-org -> 404)
    setupPhotoSelect(null) // photo absente pour cette org

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(404)
    // canDeletePhoto ne doit pas etre appele (photo non trouvee -> sortie anticipee)
    expect(mockCanDeletePhoto).not.toHaveBeenCalled()
  })

  it('TST-K4-11 : x-user-role: admin forge SANS JWT valide -> 401', async () => {
    // resolvePhotoActor retourne null car getUser() ne trouve rien et pas de cookie ouvrier
    mockResolvePhotoActor.mockResolvedValueOnce(null)

    const reqForged = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
      method: 'DELETE',
      headers: {
        'x-user-role': 'admin',
        'x-organisation-id': ORG_A,
        'x-user-id': USER_1,
      },
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(reqForged, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(401)
  })

  it('TST-K4-12 : cookie ouvrier + x-* forge -> traite ouvrier (auteur -> 204)', async () => {
    // resolvePhotoActor retourne ouvrier (JWT invalide, cookie valide)
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_OUVRIER_AUTEUR)
    mockCanDeletePhoto.mockReturnValueOnce(true) // auteur -> OK
    setupDeleteSuccess()
    mockStorageFrom.mockReturnValue({
      remove: vi.fn().mockResolvedValue({ error: null }),
    })

    const reqWithForgedHeader = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
      method: 'DELETE',
      headers: {
        cookie: 'ouvrier_session=test-session',
        'x-user-role': 'conducteur',
      },
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(reqWithForgedHeader, { params: Promise.resolve({ id: PHOTO_ID }) })
    // Traite comme ouvrier auteur -> 204
    expect(res.status).toBe(204)
  })

  it('TST-K4-14 : Storage.remove KO -> 204 + warn log (best-effort D-4-009)', async () => {
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_OUVRIER_AUTEUR)
    mockCanDeletePhoto.mockReturnValueOnce(true)
    setupDeleteSuccess()
    // Storage.remove echoue
    mockStorageFrom.mockReturnValue({
      remove: vi.fn().mockResolvedValue({ error: new Error('Storage unavailable') }),
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })

    // Ligne DB supprimee quand meme -> 204 (best-effort)
    expect(res.status).toBe(204)
    // Un warn a ete logge
    expect(mockWarnLog).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(String) }),
      expect.stringContaining('Storage.remove KO'),
    )
  })
})
