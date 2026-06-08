/**
 * tests/unit/ouvrier-galerie-handler.test.ts
 * Tests GET /api/ouvrier/chantiers/[id] — extension photos Sprint 4 (D-4-007)
 *
 * TST-K4-21 : reponse sans storage_path ET sans note_privee_conducteur (K4-NPR-01)
 *             tache is_mine=false -> 0 photo (K4-HI-IDOR)
 * US-4.4 : 51 photos -> 50 retournees + photos_truncated: true (RG-PHOTO-007)
 * D-4-007 : breaking change assertions photos[] remplace photos_count
 * TST-K4-23 : signed_url present dans reponse (non loguee)
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
  getOuvrierSession: (...args: unknown[]) => mockGetOuvrierSession(...args),
  OUVRIER_SESSION_TTL: 604800,
  SESSION_PREFIX: 'ouvrier_session:',
  USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
  REDIS_SESSION_PREFIX: 'ouvrier_session:',
  REDIS_USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
}))

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}))

vi.mock('../../lib/photos-access', () => ({
  signPhotoPaths: async (...args: unknown[]) => mockSignPhotoPaths(...args),
  resolvePhotoActor: vi.fn(),
  canDeletePhoto: vi.fn(),
  validateImageBuffer: vi.fn(),
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
const USER_ID = '00000000-0000-0000-0000-000000000010'
const OTHER_USER = '00000000-0000-0000-0000-000000000011'
const CHANTIER_ID = '00000000-0000-0000-0000-000000000020'
const TACHE_MIENNE_ID = '00000000-0000-0000-0000-000000000021'
const TACHE_AUTRE_ID = '00000000-0000-0000-0000-000000000022'

const VALID_SESSION = {
  user_id: USER_ID,
  organisation_id: ORG_ID,
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

const VALID_CHANTIER = {
  id: CHANTIER_ID,
  nom: 'Chantier Test',
  client_nom: 'Client',
  adresse: '1 rue Test',
  code_postal: '75001',
  statut: 'actif',
  date_debut: '2026-01-01',
  date_fin_prevue: '2026-12-31',
  created_by: '00000000-0000-0000-0000-000000000099',
}

function makeTache(id: string, assignedTo: string | null) {
  return {
    id,
    titre: 'Tache',
    statut: 'a_faire' as const,
    description: null,
    bloque_raison: null,
    assigned_to: assignedTo,
    date_echeance: null,
    created_at: '2026-01-01T00:00:00Z',
    // note_privee_conducteur JAMAIS dans cette liste (D-3-004)
  }
}

function makePhoto(tacheId: string, index: number) {
  return {
    id: `photo-${index}`,
    tache_id: tacheId,
    storage_path: `${ORG_ID}/${tacheId}/photo-${index}.jpg`,
    commentaire: `Commentaire ${index}`,
    uploader_id: USER_ID,
    created_at: `2026-06-0${(index % 9) + 1}T00:00:00Z`,
  }
}

function buildRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/ouvrier/chantiers/${CHANTIER_ID}`)
}

// Setup mocks pour le chemin happy path
function setupAdminMocks(
  taches: ReturnType<typeof makeTache>[],
  photos: ReturnType<typeof makePhoto>[],
) {
  let callIndex = 0
  mockAdminFrom.mockImplementation((table: string) => {
    callIndex++

    if (table === 'affectations' && callIndex === 1) {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({
                  limit: () => Promise.resolve({ data: [{ id: 'aff-1' }], error: null }),
                }),
              }),
            }),
          }),
        }),
      }
    }

    if (table === 'chantiers') {
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

    if (table === 'taches') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: taches, error: null }),
          }),
        }),
      }
    }

    if (table === 'photos') {
      return {
        select: () => ({
          in: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: photos, error: null }),
              }),
            }),
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
              data: { nom: 'Martin', prenom: 'Paul', telephone: null },
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

describe('GET /api/ouvrier/chantiers/[id] — extension photos Sprint 4', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('TST-K4-21 : note_privee_conducteur ABSENT + storage_path ABSENT (K4-NPR-01)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheMienne = makeTache(TACHE_MIENNE_ID, USER_ID)
    const photo = makePhoto(TACHE_MIENNE_ID, 1)
    setupAdminMocks([tacheMienne], [photo])
    mockSignPhotoPaths.mockResolvedValueOnce(new Map([[photo.storage_path, 'https://signed.example.com']]))

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(200)

    const body = await res.json() as { taches: Array<Record<string, unknown>> }
    const responseText = JSON.stringify(body)

    // note_privee_conducteur JAMAIS dans la reponse (K4-NPR-01)
    expect(responseText).not.toContain('note_privee_conducteur')

    // storage_path JAMAIS dans la reponse (K4-NPR-01, D-4-006)
    expect(responseText).not.toContain('storage_path')

    // signed_url PRESENT (D-4-007)
    expect(responseText).toContain('signed_url')
  })

  it('TST-K4-21 : tache is_mine=false -> 0 photo dans la reponse (K4-HI-IDOR)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheAutre = makeTache(TACHE_AUTRE_ID, OTHER_USER) // pas mienne
    setupAdminMocks([tacheAutre], []) // pas de photos chargees pour non-mienne
    // signPhotoPaths ne doit pas etre appele (aucune tache mienne)
    mockSignPhotoPaths.mockResolvedValueOnce(new Map())

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(200)

    const body = await res.json() as { taches: Array<Record<string, unknown>> }
    const tache = body.taches[0]

    expect(tache['is_mine']).toBe(false)
    // TacheAutre n'a pas de propriete photos (D-4-007)
    expect(tache).not.toHaveProperty('photos')
    // photos_count AUSSI absent (D-4-007 breaking change)
    expect(tache).not.toHaveProperty('photos_count')
  })

  it('D-4-007 : photos[] present pour tache is_mine=true (breaking change)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheMienne = makeTache(TACHE_MIENNE_ID, USER_ID)
    const photo = makePhoto(TACHE_MIENNE_ID, 1)
    setupAdminMocks([tacheMienne], [photo])
    mockSignPhotoPaths.mockResolvedValueOnce(new Map([[photo.storage_path, 'https://signed.example.com']]))

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(200)

    const body = await res.json() as { taches: Array<Record<string, unknown>> }
    const tache = body.taches[0]

    expect(tache['is_mine']).toBe(true)
    expect(tache).toHaveProperty('photos')
    expect(Array.isArray(tache['photos'])).toBe(true)
    expect((tache['photos'] as unknown[]).length).toBe(1)
    // photos_count supprime (D-4-007)
    expect(tache).not.toHaveProperty('photos_count')
  })

  it('US-4.4 : 51 photos -> 50 retournees + photos_truncated: true (RG-PHOTO-007)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheMienne = makeTache(TACHE_MIENNE_ID, USER_ID)
    // 51 photos pour declencher la troncature
    const photosArray = Array.from({ length: 51 }, (_, i) => makePhoto(TACHE_MIENNE_ID, i + 1))
    setupAdminMocks([tacheMienne], photosArray)

    // signPhotoPaths avec tous les paths
    const signedMap = new Map(photosArray.map((p) => [p.storage_path, `https://signed.example.com/${p.id}`]))
    mockSignPhotoPaths.mockResolvedValueOnce(signedMap)

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(200)

    const body = await res.json() as { taches: Array<Record<string, unknown>> }
    const tache = body.taches[0]

    // 50 photos max (pas 51)
    expect(tache['is_mine']).toBe(true)
    const photos = tache['photos'] as unknown[]
    expect(photos.length).toBe(50)

    // photos_truncated: true signale
    expect(tache['photos_truncated']).toBe(true)
  })

  it('TST-K4-23 : photos sans storage_path dans les PhotoOuvrierDisplay', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    const tacheMienne = makeTache(TACHE_MIENNE_ID, USER_ID)
    const photo = makePhoto(TACHE_MIENNE_ID, 1)
    setupAdminMocks([tacheMienne], [photo])
    const SIGNED_URL = `https://signed.example.com/${photo.id}`
    mockSignPhotoPaths.mockResolvedValueOnce(new Map([[photo.storage_path, SIGNED_URL]]))

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const res = await GET(buildRequest(), { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(res.status).toBe(200)

    const body = await res.json() as { taches: Array<Record<string, unknown>> }
    const photos = body.taches[0]['photos'] as Array<Record<string, unknown>>

    // Chaque PhotoOuvrierDisplay a signed_url mais pas storage_path
    expect(photos[0]).toHaveProperty('signed_url', SIGNED_URL)
    expect(photos[0]).not.toHaveProperty('storage_path')
    expect(photos[0]).toHaveProperty('id')
    expect(photos[0]).toHaveProperty('uploader_id')
  })
})
