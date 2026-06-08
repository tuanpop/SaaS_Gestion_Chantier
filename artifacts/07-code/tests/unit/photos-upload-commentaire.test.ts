/**
 * tests/unit/photos-upload-commentaire.test.ts
 * Tests POST /api/photos — couverture US-4.3 (commentaire)
 * + RG-PHOTO-002b HEIC retiré (D-056/PO-4-02 amendé 2026-06-07)
 *
 * NOTE sur BUG-Z02 : couvert dans photos-upload.test.ts (TST-K4-04).
 * L'angle "défense en profondeur validateImageBuffer taille" est couvert par
 * photos-access.test.ts (TST-K4-04 validateImageBuffer bigBuf -> ok:false).
 *
 * NOTE sur le mock @/lib/photos-access vs ../../lib/photos-access :
 * Le handler route.ts importe via l'alias @/. Ce fichier mocke via le chemin
 * relatif. Pour les tests commentaire, validateImageBuffer est mocké ET le
 * handler l'appelle bien via l'alias résolu par vitest alias config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockGetOuvrierSession = vi.fn()
const mockAdminFrom = vi.fn()
const mockStorageFrom = vi.fn()
const mockValidateImageBuffer = vi.fn()
const mockSignPhotoPaths = vi.fn()
const mockCheckRateLimit = vi.fn()

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
      from: (...args: unknown[]) => mockStorageFrom(...args),
    },
  }),
}))

vi.mock('../../lib/photos-access', () => ({
  validateImageBuffer: (...args: unknown[]) => mockValidateImageBuffer(...args),
  signPhotoPaths: async (...args: unknown[]) => mockSignPhotoPaths(...args),
  resolvePhotoActor: vi.fn(),
  canDeletePhoto: vi.fn(),
}))

vi.mock('../../lib/cache', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: {
    photoUpload: { limit: 20, windowMs: 3_600_000 },
  },
}))

vi.mock('@/lib/cache', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: {
    photoUpload: { limit: 20, windowMs: 3_600_000 },
  },
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
const USER_ID  = '00000000-0000-0000-0000-000000000010'
const TACHE_ID = '00000000-0000-0000-0000-000000000020'

const VALID_SESSION = {
  user_id: USER_ID,
  organisation_id: ORG_ID,
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

const RL_ALLOWED = { allowed: true, remaining: 19, resetAt: new Date() }

// Magic bytes JPEG valides
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0x00)])

function buildFormDataRequest(
  tacheId: string,
  file: Blob,
  commentaire?: string,
): NextRequest {
  const form = new FormData()
  form.append('tache_id', tacheId)
  form.append('file', file, 'photo.jpg')
  if (commentaire !== undefined) form.append('commentaire', commentaire)
  return new NextRequest('http://localhost/api/photos', {
    method: 'POST',
    body: form,
    headers: { cookie: 'ouvrier_session=test-session' },
  })
}

function setupHappyPathMocks(commentaireInBase: string | null = null) {
  mockStorageFrom.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ data: { path: 'test' }, error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  })
  let callIndex = 0
  mockAdminFrom.mockImplementation((table: string) => {
    callIndex++
    if (table === 'taches') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: TACHE_ID, assigned_to: USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'photos') {
      return {
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: {
                id: 'photo-uuid',
                tache_id: TACHE_ID,
                commentaire: commentaireInBase,
                created_at: '2026-06-07T00:00:00Z',
                uploader_id: USER_ID,
              },
              error: null,
            }),
          }),
        }),
      }
    }
    return { select: vi.fn() }
  })
  mockSignPhotoPaths.mockImplementation(async (paths: string[]) => {
    const map = new Map<string, string>()
    paths.forEach((p: string) => map.set(p, `https://signed.example.com/${p}`))
    return map
  })
}

// ============================================================
// Tests
// ============================================================

describe('POST /api/photos — commentaire (US-4.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('US-4.3-HP : commentaire 50 chars -> 201, commentaire persisté dans la réponse', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockValidateImageBuffer.mockReturnValueOnce({ ok: true, ext: 'jpg' })
    mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)
    const commentaire50 = 'A'.repeat(50)
    setupHappyPathMocks(commentaire50)

    const jpegBlob = new Blob([JPEG_MAGIC], { type: 'image/jpeg' })
    const req = buildFormDataRequest(TACHE_ID, jpegBlob, commentaire50)

    const { POST } = await import('../../app/api/photos/route')
    const res = await POST(req)

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    // La réponse contient le commentaire (propagé depuis le DB mock)
    expect(body).toHaveProperty('commentaire', commentaire50)
    // signed_url présent, storage_path absent
    expect(body).toHaveProperty('signed_url')
    expect(body).not.toHaveProperty('storage_path')
  })

  it('US-4.3-NULL : commentaire absent -> 201, body.commentaire est null', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockValidateImageBuffer.mockReturnValueOnce({ ok: true, ext: 'jpg' })
    mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)
    setupHappyPathMocks(null)

    const jpegBlob = new Blob([JPEG_MAGIC], { type: 'image/jpeg' })
    // Pas de commentaire dans le form
    const req = buildFormDataRequest(TACHE_ID, jpegBlob)

    const { POST } = await import('../../app/api/photos/route')
    const res = await POST(req)

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body['commentaire']).toBeNull()
  })

  it('US-4.3-ERR : commentaire 501 chars -> 400 (Zod, avant upload)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)
    // Note : validateImageBuffer n'est PAS mocké ici car le Zod check (commentaire > 500) rejette avant

    const commentaire501 = 'B'.repeat(501)
    const jpegBlob = new Blob([JPEG_MAGIC], { type: 'image/jpeg' })
    const req = buildFormDataRequest(TACHE_ID, jpegBlob, commentaire501)

    const { POST } = await import('../../app/api/photos/route')
    const res = await POST(req)

    expect(res.status).toBe(400)
    // Aucun upload ne doit avoir eu lieu
    expect(mockStorageFrom).not.toHaveBeenCalled()
  })

  it('RG-PHOTO-002b : HEIC retiré (D-056/PO-4-02 amendé 2026-06-07) -> 400', async () => {
    // HEIC a été retiré de la whitelist — validateImageBuffer retourne false pour image/heic
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)
    mockValidateImageBuffer.mockReturnValueOnce({ ok: false, error: 'Format non supporté.' })

    const heicBlob = new Blob([Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])], { type: 'image/heic' })
    const req = buildFormDataRequest(TACHE_ID, heicBlob)

    const { POST } = await import('../../app/api/photos/route')
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(mockStorageFrom).not.toHaveBeenCalled()
  })
})

// ============================================================
// BUG-Z02 documentation (skip — contrainte Vitest/Node)
// ============================================================

describe('BUG-Z02 non-régression : rejet taille AVANT bufférisation', () => {
  it.skip('BUG-Z02 : Object.defineProperty size perdu via FormData -> skip (couvert TST-K4-04 + photos-access.test.ts)', () => {
    // SKIP DOCUMENTÉ : Object.defineProperty sur Blob.size ne persiste pas lors du passage
    // par FormData.append() -> NextRequest -> request.formData() dans le handler Node.
    // La Blob est reconstruite avec sa taille réelle par le runtime WHATWG.
    //
    // Couverture BUG-Z02 assurée par :
    //   - photos-upload.test.ts TST-K4-04 : même contrainte documentée par Amelia (DECISIONLOG 2026-06-07)
    //     → retourne 400 via validateImageBuffer (si file.size bypass) ou file.size direct
    //   - photos-access.test.ts TST-K4-04 : validateImageBuffer(bigBuf > 10Mo, 'image/jpeg') -> ok:false
    //     → prouve la défense en profondeur sur le buffer réel
    //   - Code review : handler ligne 96 `if (file.size > MAX_UPLOAD_SIZE)` vérifié par Zoro
    //
    // GAP-09 documenté : test E2E upload > 10 Mo -> 400 nécessite smoke ou Playwright.
    expect(true).toBe(true)
  })
})
