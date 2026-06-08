/**
 * tests/unit/photos-rollback.test.ts
 * Tests POST /api/photos — rollback Storage si INSERT DB échoue (RG-PHOTO-004)
 * + Couverture PATCH rollback (aucun rollback Storage, UPDATE seul)
 *
 * RG-PHOTO-004 : après upload Storage réussi, si INSERT DB échoue,
 *                le handler DOIT tenter storage.remove([storage_path]) (best-effort)
 *                et retourner 500.
 *
 * ROLLBACK-HP   : INSERT DB KO -> Storage.remove appelé + 500
 * ROLLBACK-FAIL : INSERT DB KO + Storage.remove KO aussi -> 500 + error loggé
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockGetOuvrierSession = vi.fn()
const mockAdminFrom = vi.fn()
const mockStorageUpload = vi.fn()
const mockStorageRemove = vi.fn()
const mockValidateImageBuffer = vi.fn()
const mockSignPhotoPaths = vi.fn()
const mockCheckRateLimit = vi.fn()
const mockErrorLog = vi.fn()
const mockWarnLog = vi.fn()

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
        upload: async (...args: unknown[]) => mockStorageUpload(...args),
        remove: async (...args: unknown[]) => mockStorageRemove(...args),
      }),
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
    warn: mockWarnLog,
    error: mockErrorLog,
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      warn: mockWarnLog,
      error: mockErrorLog,
      info: vi.fn(),
      debug: vi.fn(),
    })),
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

function buildRequest(): NextRequest {
  const form = new FormData()
  form.append('tache_id', TACHE_ID)
  form.append('file', new Blob([JPEG_MAGIC], { type: 'image/jpeg' }), 'photo.jpg')
  return new NextRequest('http://localhost/api/photos', {
    method: 'POST',
    body: form,
    headers: { cookie: 'ouvrier_session=test-session' },
  })
}

// ============================================================
// Tests
// ============================================================

describe('POST /api/photos — rollback Storage si INSERT DB KO (RG-PHOTO-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('ROLLBACK-HP : INSERT DB KO -> Storage.remove appelé + réponse 500 (K4-MED-02)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockValidateImageBuffer.mockReturnValueOnce({ ok: true, ext: 'jpg' })
    mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)

    // Storage.upload OK
    mockStorageUpload.mockResolvedValueOnce({ data: { path: 'test' }, error: null })
    // Storage.remove OK (rollback)
    mockStorageRemove.mockResolvedValueOnce({ error: null })

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
      if (table === 'photos') {
        // INSERT DB ÉCHOUE
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: null,
                error: new Error('DB unique violation'),
              }),
            }),
          }),
        }
      }
      return { select: vi.fn() }
    })

    const { POST } = await import('../../app/api/photos/route')
    const res = await POST(buildRequest())

    // 500 retourné car INSERT KO
    expect(res.status).toBe(500)
    // Storage.remove DOIT avoir été appelé pour nettoyer (RG-PHOTO-004)
    expect(mockStorageRemove).toHaveBeenCalled()
  })

  it('ROLLBACK-FAIL : INSERT DB KO + Storage.remove KO -> 500 + erreur loggée (K4-MED-02)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(VALID_SESSION)
    mockValidateImageBuffer.mockReturnValueOnce({ ok: true, ext: 'jpg' })
    mockCheckRateLimit.mockReturnValueOnce(RL_ALLOWED)

    mockStorageUpload.mockResolvedValueOnce({ data: { path: 'test' }, error: null })
    // Storage.remove ÉCHOUE aussi (double panne)
    mockStorageRemove.mockResolvedValueOnce({ error: new Error('Storage also down') })

    mockAdminFrom.mockImplementation((table: string) => {
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
            single: () => Promise.resolve({ data: null, error: new Error('DB down') }),
          }),
        }),
      }
    })

    const { POST } = await import('../../app/api/photos/route')
    const res = await POST(buildRequest())

    expect(res.status).toBe(500)
    // L'erreur du rollback doit être loggée
    expect(mockErrorLog).toHaveBeenCalled()
  })
})
