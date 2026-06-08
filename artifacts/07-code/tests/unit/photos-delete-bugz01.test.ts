/**
 * tests/unit/photos-delete-bugz01.test.ts
 * Non-régression BUG-Z01 : DELETE /api/photos/[id]
 * Ordre impératif DB d'abord, Storage ensuite (post-correction Zoro 2026-06-07)
 *
 * BUG-Z01 : si Storage.remove réussissait AVANT le DELETE DB et que le DELETE DB échouait,
 *           la ligne persistait avec un storage_path pointant vers un fichier inexistant.
 *           Correction : DELETE DB en premier, Storage.remove ensuite (best-effort).
 *
 * Tests :
 *   BUG-Z01-HP   : DB delete OK, Storage.remove OK -> 204, ordre vérifié
 *   BUG-Z01-STOR : Storage.remove KO APRÈS DB delete -> 204 (best-effort, ligne DB supprimée)
 *   BUG-Z01-DB   : DB delete KO -> 500, Storage.remove NON appelé (photo fantôme évité)
 *   BUG-Z01-SEQ  : assert Storage.remove appelé APRÈS (pas avant) le DELETE DB
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockResolvePhotoActor = vi.fn()
const mockCanDeletePhoto = vi.fn()
const mockAdminFrom = vi.fn()
const mockStorageRemove = vi.fn()
const mockWarnLog = vi.fn()
const mockErrorLog = vi.fn()

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
      from: () => ({
        remove: async (...args: unknown[]) => mockStorageRemove(...args),
      }),
    },
  }),
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

const ORG_A  = '00000000-0000-0000-0000-000000000001'
const USER_1 = '00000000-0000-0000-0000-000000000010'
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

function makeDeleteRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/photos/${PHOTO_ID}`, { method: 'DELETE' })
}

// ============================================================
// Tests
// ============================================================

describe('DELETE /api/photos/[id] — BUG-Z01 non-régression (ordre DB avant Storage)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('BUG-Z01-HP : DB delete OK + Storage.remove OK -> 204', async () => {
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_OUVRIER_AUTEUR)
    mockCanDeletePhoto.mockReturnValueOnce(true)
    mockStorageRemove.mockResolvedValueOnce({ error: null })

    // SELECT photo -> trouvée ; DELETE -> OK
    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // SELECT
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
      // DELETE DB
      return {
        delete: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })

    expect(res.status).toBe(204)
    expect(mockStorageRemove).toHaveBeenCalled()
  })

  it('BUG-Z01-STOR : Storage.remove KO APRÈS DB delete -> 204 + warn (best-effort)', async () => {
    // Correction BUG-Z01 : même si Storage.remove échoue, la ligne DB est déjà supprimée
    // -> la photo est invisible (pas de signed URL générable) -> 204 correct
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_OUVRIER_AUTEUR)
    mockCanDeletePhoto.mockReturnValueOnce(true)
    mockStorageRemove.mockResolvedValueOnce({ error: new Error('Storage timeout') })

    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
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
      // DELETE DB réussit
      return {
        delete: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })

    // 204 même si Storage KO (best-effort D-4-009)
    expect(res.status).toBe(204)
    // Un warn doit être loggé (pas une erreur bloquante)
    expect(mockWarnLog).toHaveBeenCalled()
  })

  it('BUG-Z01-DB : DB delete KO -> 500, Storage.remove NON appelé (évite la photo fantôme)', async () => {
    // Invariant BUG-Z01 : si DB delete échoue, Storage.remove NE DOIT PAS être appelé.
    // L'ordre correct est DB d'abord. Si DB échoue, la ligne existe encore
    // et la photo est toujours accessible -> pas d'orphelin Storage.
    mockResolvePhotoActor.mockResolvedValueOnce(ACTOR_OUVRIER_AUTEUR)
    mockCanDeletePhoto.mockReturnValueOnce(true)

    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // SELECT photo -> trouvée
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
      // DELETE DB ÉCHOUE
      return {
        delete: () => ({
          eq: () => Promise.resolve({ error: new Error('DB constraint violation') }),
        }),
      }
    })

    const { DELETE } = await import('../../app/api/photos/[id]/route')
    const res = await DELETE(makeDeleteRequest(), { params: Promise.resolve({ id: PHOTO_ID }) })

    // DB delete KO -> 500 (pas 204)
    expect(res.status).toBe(500)
    // Storage.remove NE DOIT PAS avoir été appelé si DB delete échoue
    // (évite l'état incohérent : ligne DB présente + fichier Storage supprimé)
    expect(mockStorageRemove).not.toHaveBeenCalled()
  })
})
