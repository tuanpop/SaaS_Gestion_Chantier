/**
 * tests/unit/ouvrier-logout.test.ts
 * Tests POST /api/ouvrier/logout — TST-K4-19, TST-K4-20
 *
 * TST-K4-19 : session valide -> sessionStore.delete + 200 + cookie Max-Age=0
 *             attributs HttpOnly/Secure/SameSite=Lax/Path=/
 * TST-K4-20 : sans cookie -> 200 idempotent (sessionStore.delete NOT called)
 *             body { session_id: 'autre' } -> seul cookie propre supprime
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockSessionDelete = vi.fn()
const mockWarnLog = vi.fn()

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: vi.fn(),
  }),
}))

vi.mock('../../lib/session-store', () => ({
  getSessionStore: () => ({
    delete: async (...args: unknown[]) => mockSessionDelete(...args),
    read: vi.fn(),
    create: vi.fn(),
    touch: vi.fn(),
    invalidateForUser: vi.fn(),
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
// Tests
// ============================================================

describe('POST /api/ouvrier/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('TST-K4-19 : session valide -> 200 + sessionStore.delete + cookie Max-Age=0', async () => {
    const sessionId = 'valid-session-id-12345'
    mockSessionDelete.mockResolvedValueOnce(undefined)

    const req = new NextRequest('http://localhost/api/ouvrier/logout', {
      method: 'POST',
      headers: { cookie: `ouvrier_session=${sessionId}` },
    })

    const { POST } = await import('../../app/api/ouvrier/logout/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)

    // sessionStore.delete appele avec le sessionId du cookie
    expect(mockSessionDelete).toHaveBeenCalledWith(sessionId)

    // Cookie efface avec Max-Age=0 (K4-LOW-08)
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/ouvrier_session=/)
    expect(setCookie).toMatch(/Max-Age=0/)
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Secure/)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\//)
  })

  it('TST-K4-20 : sans cookie -> 200 idempotent, sessionStore.delete NOT called', async () => {
    const req = new NextRequest('http://localhost/api/ouvrier/logout', {
      method: 'POST',
      // Pas de cookie ouvrier_session
    })

    const { POST } = await import('../../app/api/ouvrier/logout/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockSessionDelete).not.toHaveBeenCalled()

    // Cookie quand meme efface (Max-Age=0) meme si pas present
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/Max-Age=0/)
  })

  it('TST-K4-20 : body { session_id: "autre" } -> seul le cookie propre supprime', async () => {
    // K4-MED-09 BINDING : le handler lit UNIQUEMENT le cookie, jamais le body
    const sessionId = 'cookie-session-id'
    mockSessionDelete.mockResolvedValueOnce(undefined)

    const req = new NextRequest('http://localhost/api/ouvrier/logout', {
      method: 'POST',
      headers: {
        cookie: `ouvrier_session=${sessionId}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session_id: 'body-injected-session-id' }),
    })

    const { POST } = await import('../../app/api/ouvrier/logout/route')
    await POST(req)

    // sessionStore.delete appele avec l'ID DU COOKIE (pas du body)
    expect(mockSessionDelete).toHaveBeenCalledWith(sessionId)
    expect(mockSessionDelete).not.toHaveBeenCalledWith('body-injected-session-id')
  })

  it('TST-K4-19 : Postgres down -> 200 + cookie Max-Age=0 + warn log (best-effort)', async () => {
    const sessionId = 'valid-session-id'
    mockSessionDelete.mockRejectedValueOnce(new Error('Postgres connection refused'))

    const req = new NextRequest('http://localhost/api/ouvrier/logout', {
      method: 'POST',
      headers: { cookie: `ouvrier_session=${sessionId}` },
    })

    const { POST } = await import('../../app/api/ouvrier/logout/route')
    const res = await POST(req)

    // Best-effort : 200 meme si Postgres down (RG-LOGOUT-001)
    expect(res.status).toBe(200)

    // Cookie efface quand meme
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/Max-Age=0/)

    // Warn logge
    expect(mockWarnLog).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(String) }),
      expect.stringContaining('best-effort'),
    )
  })
})
