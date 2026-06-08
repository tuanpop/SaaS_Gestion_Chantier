/**
 * tests/unit/photos-access.test.ts
 * Tests unitaires lib/photos-access.ts — FICHIER SECURITE CRITIQUE (K4-MED-12)
 *
 * Scenarios :
 *   resolvePhotoActor : chemin JWT staff, chemin cookie ouvrier, null
 *   canDeletePhoto : matrice 4 cas (auteur OK, non-auteur KO, staff meme org OK, staff autre org KO)
 *   validateImageBuffer : JPEG valide, magic mismatch, taille depassee, WebP valide, PNG valide, SVG -> false
 *   signPhotoPaths : tableau vide, N paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks
// ============================================================

const mockGetUser = vi.fn()
const mockCreateSignedUrls = vi.fn()

vi.mock('../../lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => mockGetUser(),
    },
  }),
}))

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrls: async (...args: unknown[]) => mockCreateSignedUrls(...args),
      }),
    },
  }),
}))

const mockGetOuvrierSession = vi.fn()
vi.mock('../../lib/ouvrier-session', () => ({
  getOuvrierSession: async (...args: unknown[]) => mockGetOuvrierSession(...args),
  OUVRIER_SESSION_TTL: 604800,
  SESSION_PREFIX: 'ouvrier_session:',
  USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
  REDIS_SESSION_PREFIX: 'ouvrier_session:',
  REDIS_USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

// ============================================================
// Imports apres mocks
// ============================================================

import { NextRequest } from 'next/server'
import type { PhotoActor } from '../../lib/photos-access'

// ============================================================
// Fixtures
// ============================================================

const ORG_A = '00000000-0000-0000-0000-000000000001'
const ORG_B = '00000000-0000-0000-0000-000000000002'
const USER_1 = '00000000-0000-0000-0000-000000000010'
const USER_2 = '00000000-0000-0000-0000-000000000011'

const PHOTO_ORG_A = {
  id: 'photo-1',
  uploader_id: USER_1,
  organisation_id: ORG_A,
  storage_path: `${ORG_A}/tache-1/photo-1.jpg`,
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/photos/photo-1', {
    method: 'DELETE',
    headers: { cookie: 'ouvrier_session=test-session' },
  })
}

// ============================================================
// resolvePhotoActor
// ============================================================

describe('resolvePhotoActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('chemin staff : JWT valide conducteur -> acteur staff', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: USER_1,
          app_metadata: { role: 'conducteur', organisation_id: ORG_A },
        },
      },
    })

    const { resolvePhotoActor } = await import('../../lib/photos-access')
    const actor = await resolvePhotoActor(makeRequest())

    expect(actor).not.toBeNull()
    expect(actor?.kind).toBe('staff')
    expect(actor?.userId).toBe(USER_1)
    expect(actor?.organisationId).toBe(ORG_A)
    if (actor?.kind === 'staff') {
      expect(actor.role).toBe('conducteur')
    }
  })

  it('chemin staff : JWT valide admin -> acteur staff', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: USER_1,
          app_metadata: { role: 'admin', organisation_id: ORG_A },
        },
      },
    })

    const { resolvePhotoActor } = await import('../../lib/photos-access')
    const actor = await resolvePhotoActor(makeRequest())

    expect(actor?.kind).toBe('staff')
    if (actor?.kind === 'staff') {
      expect(actor.role).toBe('admin')
    }
  })

  it('chemin ouvrier : pas de JWT valide + cookie ouvrier valide -> acteur ouvrier', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockGetOuvrierSession.mockResolvedValueOnce({
      user_id: USER_1,
      organisation_id: ORG_A,
      role: 'ouvrier',
      affectations: [],
      created_at: Date.now(),
    })

    const { resolvePhotoActor } = await import('../../lib/photos-access')
    const actor = await resolvePhotoActor(makeRequest())

    expect(actor).not.toBeNull()
    expect(actor?.kind).toBe('ouvrier')
    expect(actor?.userId).toBe(USER_1)
    expect(actor?.organisationId).toBe(ORG_A)
  })

  it('TST-K4-11 : x-user-role forge SANS JWT valide -> null (pas de staff)', async () => {
    // Simule: un attaquant forge le header x-user-role: admin mais n'a pas de JWT valide
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockGetOuvrierSession.mockResolvedValueOnce(null) // pas de cookie ouvrier non plus

    const reqWithForgedHeader = new NextRequest('http://localhost/api/photos/photo-1', {
      method: 'DELETE',
      headers: {
        'x-user-role': 'admin',
        'x-organisation-id': ORG_A,
        'x-user-id': USER_1,
      },
    })

    const { resolvePhotoActor } = await import('../../lib/photos-access')
    const actor = await resolvePhotoActor(reqWithForgedHeader)

    // resolvePhotoActor NE LIT PAS x-* -> retourne null
    expect(actor).toBeNull()
  })

  it('TST-K4-12 : cookie ouvrier + x-* forge -> traite comme ouvrier', async () => {
    // JWT invalide (pas de user)
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    // Mais cookie ouvrier valide
    mockGetOuvrierSession.mockResolvedValueOnce({
      user_id: USER_2,
      organisation_id: ORG_A,
      role: 'ouvrier',
      affectations: [],
      created_at: Date.now(),
    })

    const reqWithForgedHeader = new NextRequest('http://localhost/api/photos/photo-1', {
      method: 'DELETE',
      headers: {
        cookie: 'ouvrier_session=test-session',
        'x-user-role': 'conducteur',
      },
    })

    const { resolvePhotoActor } = await import('../../lib/photos-access')
    const actor = await resolvePhotoActor(reqWithForgedHeader)

    // Doit etre traite comme ouvrier (pas staff)
    expect(actor?.kind).toBe('ouvrier')
    expect(actor?.userId).toBe(USER_2)
  })

  it('sans JWT ni cookie -> null (401 cote handler)', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockGetOuvrierSession.mockResolvedValueOnce(null)

    const { resolvePhotoActor } = await import('../../lib/photos-access')
    const actor = await resolvePhotoActor(makeRequest())

    expect(actor).toBeNull()
  })
})

// ============================================================
// canDeletePhoto
// ============================================================

describe('canDeletePhoto', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ouvrier auteur meme org -> true', async () => {
    const { canDeletePhoto } = await import('../../lib/photos-access')
    const actor: PhotoActor = { kind: 'ouvrier', userId: USER_1, organisationId: ORG_A }
    expect(canDeletePhoto(actor, PHOTO_ORG_A)).toBe(true)
  })

  it('ouvrier non-auteur meme org -> false', async () => {
    const { canDeletePhoto } = await import('../../lib/photos-access')
    const actor: PhotoActor = { kind: 'ouvrier', userId: USER_2, organisationId: ORG_A }
    expect(canDeletePhoto(actor, PHOTO_ORG_A)).toBe(false)
  })

  it('staff meme org -> true (K4-CR-02 : meme org suffit pour moderation)', async () => {
    const { canDeletePhoto } = await import('../../lib/photos-access')
    const actor: PhotoActor = { kind: 'staff', userId: USER_2, organisationId: ORG_A, role: 'conducteur' }
    expect(canDeletePhoto(actor, PHOTO_ORG_A)).toBe(true)
  })

  it('TST-K4-10 : staff autre org -> false (K4-CR-02 isolation)', async () => {
    const { canDeletePhoto } = await import('../../lib/photos-access')
    const actor: PhotoActor = { kind: 'staff', userId: USER_2, organisationId: ORG_B, role: 'conducteur' }
    expect(canDeletePhoto(actor, PHOTO_ORG_A)).toBe(false)
  })
})

// ============================================================
// validateImageBuffer (K4-CR-01 BINDING)
// ============================================================

describe('validateImageBuffer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('JPEG valide -> ok:true, ext:jpg', async () => {
    const { validateImageBuffer } = await import('../../lib/photos-access')
    // Magic bytes JPEG : FF D8 FF + padding
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)])
    const result = validateImageBuffer(buf, 'image/jpeg')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ext).toBe('jpg')
  })

  it('PNG valide -> ok:true, ext:png', async () => {
    const { validateImageBuffer } = await import('../../lib/photos-access')
    // Magic bytes PNG : 89 50 4E 47 0D 0A 1A 0A
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(20).fill(0)])
    const result = validateImageBuffer(buf, 'image/png')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ext).toBe('png')
  })

  it('WebP valide -> ok:true, ext:webp', async () => {
    const { validateImageBuffer } = await import('../../lib/photos-access')
    // Magic bytes WebP : RIFF....WEBP
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,  // RIFF
      0x00, 0x00, 0x00, 0x00,  // taille (ignoree)
      0x57, 0x45, 0x42, 0x50,  // WEBP
      ...Array(20).fill(0),
    ])
    const result = validateImageBuffer(buf, 'image/webp')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ext).toBe('webp')
  })

  it('TST-K4-02 : SVG (image/svg+xml) -> ok:false (MIME hors whitelist)', async () => {
    const { validateImageBuffer } = await import('../../lib/photos-access')
    const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const result = validateImageBuffer(buf, 'image/svg+xml')
    expect(result.ok).toBe(false)
  })

  it('HEIC (image/heic) -> ok:false (HEIC retire — D-056/PO-4-02 amende 2026-06-07)', async () => {
    const { validateImageBuffer } = await import('../../lib/photos-access')
    // Simuler un buffer HEIC (ftyp a offset 4)
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, ...Array(20).fill(0)])
    const result = validateImageBuffer(buf, 'image/heic')
    expect(result.ok).toBe(false)
  })

  it('TST-K4-03 : HTML forge comme JPEG (magic mismatch) -> ok:false', async () => {
    const { validateImageBuffer } = await import('../../lib/photos-access')
    // HTML renomme .jpg — content-type image/jpeg mais magic bytes HTML
    const buf = Buffer.from('<html><body>attack</body></html>')
    const result = validateImageBuffer(buf, 'image/jpeg')
    expect(result.ok).toBe(false)
  })

  it('TST-K4-04 : fichier > 10 Mo -> ok:false', async () => {
    const { validateImageBuffer } = await import('../../lib/photos-access')
    // Buffer > 10 Mo mais avec les bons magic bytes JPEG
    const bigBuf = Buffer.alloc(11 * 1024 * 1024)
    bigBuf[0] = 0xff
    bigBuf[1] = 0xd8
    bigBuf[2] = 0xff
    const result = validateImageBuffer(bigBuf, 'image/jpeg')
    expect(result.ok).toBe(false)
  })
})

// ============================================================
// signPhotoPaths (D-4-004)
// ============================================================

describe('signPhotoPaths', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tableau vide -> Map vide (aucun appel reseau)', async () => {
    const { signPhotoPaths } = await import('../../lib/photos-access')
    const map = await signPhotoPaths([])
    expect(map.size).toBe(0)
    expect(mockCreateSignedUrls).not.toHaveBeenCalled()
  })

  it('N paths -> Map de N entries', async () => {
    const paths = [`${ORG_A}/t1/p1.jpg`, `${ORG_A}/t1/p2.png`]
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [
        { path: paths[0], signedUrl: 'https://signed-1.example.com' },
        { path: paths[1], signedUrl: 'https://signed-2.example.com' },
      ],
      error: null,
    })

    const { signPhotoPaths } = await import('../../lib/photos-access')
    const map = await signPhotoPaths(paths)

    expect(map.size).toBe(2)
    expect(map.get(paths[0])).toBe('https://signed-1.example.com')
    expect(map.get(paths[1])).toBe('https://signed-2.example.com')
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(paths, 3600)
  })
})
