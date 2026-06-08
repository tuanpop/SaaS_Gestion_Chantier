/**
 * tests/unit/photos-patch-signedurl.test.ts
 * Tests PATCH /api/photos/[id] et GET /api/photos/[id]/signed-url
 *
 * TST-K4-13 : 401 sans cookie ni JWT (toutes methodes /api/photos*)
 * TST-K4-15 : GET signed-url tache non assignee -> 403/404
 * TST-K4-16 : PATCH { commentaire, storage_path: '../x' } -> 400 (Zod strict)
 * TST-K4-17 : PATCH non-auteur -> 403
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockGetOuvrierSession = vi.fn()
const mockAdminFrom = vi.fn()
const mockSignPhotoPaths = vi.fn()

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
      from: () => ({
        createSignedUrls: vi.fn(),
      }),
    },
  }),
}))

vi.mock('../../lib/photos-access', () => ({
  resolvePhotoActor: vi.fn(),
  canDeletePhoto: vi.fn(),
  validateImageBuffer: vi.fn(),
  signPhotoPaths: async (...args: unknown[]) => mockSignPhotoPaths(...args),
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

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const USER_1  = '00000000-0000-0000-0000-000000000010'
const USER_2  = '00000000-0000-0000-0000-000000000011'
const PHOTO_ID = '00000000-0000-0000-0000-000000000030'
const TACHE_ID = '00000000-0000-0000-0000-000000000020'

const VALID_SESSION = {
  user_id: USER_1,
  organisation_id: ORG_ID,
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

// ============================================================
// Tests PATCH /api/photos/[id]
// ============================================================

describe('PATCH /api/photos/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('TST-K4-13 : sans session -> 401', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(null)

    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentaire: 'test' }),
    })

    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(401)
  })

  it('TST-K4-16 : Zod .strict() -> 400 si storage_path inclus', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)

    // Corps avec champ interdit (storage_path) -> Zod .strict() -> 400
    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentaire: 'test', storage_path: '../../../etc/passwd' }),
    })

    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(400)
  })

  it('TST-K4-16 : Zod .strict() -> 400 si tache_id inclus', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)

    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentaire: 'test', tache_id: 'some-uuid' }),
    })

    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(400)
  })

  it('TST-K4-17 : non-auteur -> 403', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION) // user USER_1

    // Photo appartenant a USER_2 (autre uploader)
    mockAdminFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: { id: PHOTO_ID, uploader_id: USER_2, organisation_id: ORG_ID, commentaire: null },
              error: null,
            }),
          }),
        }),
      }),
    })

    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentaire: 'tentative' }),
    })

    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(403)
  })

  it('auteur -> 200 avec id, commentaire, updated_at', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION) // user USER_1

    let selectCalled = false
    mockAdminFrom.mockImplementation(() => {
      if (!selectCalled) {
        selectCalled = true
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
                data: { id: PHOTO_ID, commentaire: 'nouveau', updated_at: '2026-06-07T00:00:00Z' },
                error: null,
              }),
            }),
          }),
        }),
      }
    })

    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentaire: 'nouveau' }),
    })

    const { PATCH } = await import('../../app/api/photos/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('commentaire', 'nouveau')
    expect(body).toHaveProperty('updated_at')
    // storage_path JAMAIS dans la reponse
    expect(body).not.toHaveProperty('storage_path')
  })
})

// ============================================================
// Tests GET /api/photos/[id]/signed-url
// ============================================================

describe('GET /api/photos/[id]/signed-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('TST-K4-13 : sans session -> 401', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(null)

    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}/signed-url`, {
      method: 'GET',
    })

    const { GET } = await import('../../app/api/photos/[id]/signed-url/route')
    const res = await GET(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(401)
  })

  it('TST-K4-15 : tache non assignee -> 403 (K4-HI-05)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)

    let selectCallIndex = 0
    mockAdminFrom.mockImplementation(() => {
      selectCallIndex++
      if (selectCallIndex === 1) {
        // SELECT photo -> trouvee dans l'org
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: PHOTO_ID, storage_path: 'path.jpg', tache_id: TACHE_ID, organisation_id: ORG_ID },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      // SELECT tache -> non assignee a cet ouvrier -> null
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }
    })

    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}/signed-url`, {
      method: 'GET',
    })

    const { GET } = await import('../../app/api/photos/[id]/signed-url/route')
    const res = await GET(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(403)
  })

  it('signed-url valide : reponse sans storage_path', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockSignPhotoPaths.mockResolvedValueOnce(new Map([['path.jpg', 'https://signed.example.com']]))

    let selectCallIndex = 0
    mockAdminFrom.mockImplementation(() => {
      selectCallIndex++
      if (selectCallIndex === 1) {
        // Photo trouvee
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: PHOTO_ID, storage_path: 'path.jpg', tache_id: TACHE_ID, organisation_id: ORG_ID },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      // Tache assignee a USER_1 -> OK
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: TACHE_ID }, error: null }),
              }),
            }),
          }),
        }),
      }
    })

    const req = new NextRequest(`http://localhost/api/photos/${PHOTO_ID}/signed-url`, {
      method: 'GET',
    })

    const { GET } = await import('../../app/api/photos/[id]/signed-url/route')
    const res = await GET(req, { params: Promise.resolve({ id: PHOTO_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('signed_url')
    // storage_path JAMAIS dans la reponse (K4-MED-04, D-4-006)
    expect(body).not.toHaveProperty('storage_path')
  })
})
