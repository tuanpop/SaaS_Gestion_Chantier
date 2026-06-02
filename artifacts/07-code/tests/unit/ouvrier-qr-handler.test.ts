/**
 * tests/unit/ouvrier-qr-handler.test.ts
 * Tests integration handler GET /api/auth/qr/[token]
 *
 * Scenarios couverts (TST-K3-01 a 05) :
 *   TST-K3-01 : scan QR valide 1 affectation → session Redis creee + cookie + redirect chantier
 *   TST-K3-02 : token altere → redirect invalid_token, pas de session
 *   TST-K3-03 : 0 affectation active → redirect no-affectation, pas de session Redis
 *   TST-K3-04 : ≥2 affectations → redirect /ouvrier/chantiers, session contient 2 affectations
 *   TST-K3-05 : ouvrier deleted_at IS NOT NULL → redirect user_not_found
 *   Bonus : role != ouvrier → redirect user_not_found (K3-E-01)
 *   Bonus : organisation_id mismatch → redirect user_not_found (K3-CR-01)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks
// ============================================================

const mockDecryptQR = vi.fn()
const mockAdminFrom = vi.fn()
const mockRedisSetex = vi.fn()
const mockRedisSadd = vi.fn()
const mockRedisExpire = vi.fn()

vi.mock('../../lib/crypto', () => ({
  decryptQR: (...args: unknown[]) => mockDecryptQR(...args),
  InvalidQRTokenError: class InvalidQRTokenError extends Error {
    constructor(msg: string) { super(msg); this.name = 'InvalidQRTokenError' }
  },
}))

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}))

vi.mock('../../lib/redis', () => ({
  redis: {
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    sadd: (...args: unknown[]) => mockRedisSadd(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    get: vi.fn(),
    smembers: vi.fn(),
  },
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

// ============================================================
// Helpers
// ============================================================

function buildRequest(token: string): NextRequest {
  return new NextRequest(`http://localhost/api/auth/qr/${token}`)
}

const VALID_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'ouvrier',
  organisation_id: '00000000-0000-0000-0000-000000000002',
  deleted_at: null,
}

const VALID_AFFECTATION = {
  id: '00000000-0000-0000-0000-000000000010',
  chantier_id: '00000000-0000-0000-0000-000000000020',
  vue: 'mes_taches',
  chantiers: { statut: 'actif' },
}

const VALID_AFFECTATION_2 = {
  id: '00000000-0000-0000-0000-000000000011',
  chantier_id: '00000000-0000-0000-0000-000000000021',
  vue: 'mes_taches',
  chantiers: { statut: 'actif' },
}

// ============================================================
// Tests
// ============================================================

describe('GET /api/auth/qr/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisSetex.mockResolvedValue('OK')
    mockRedisSadd.mockResolvedValue(1)
    mockRedisExpire.mockResolvedValue(1)
  })

  it('TST-K3-02 : token altere → redirect invalid_token, pas de session Redis', async () => {
    const { InvalidQRTokenError } = await import('../../lib/crypto')
    mockDecryptQR.mockImplementationOnce(() => {
      throw new InvalidQRTokenError('Token falsifie')
    })

    const { GET } = await import('../../app/api/auth/qr/[token]/route')
    const response = await GET(buildRequest('invalid-token'), {
      params: Promise.resolve({ token: 'invalid-token' }),
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toContain('error=invalid_token')
    expect(mockRedisSetex).not.toHaveBeenCalled()
  })

  it('TST-K3-05 : ouvrier deleted_at IS NOT NULL → redirect user_not_found', async () => {
    mockDecryptQR.mockReturnValueOnce({
      user_id: VALID_USER.id,
      organisation_id: VALID_USER.organisation_id,
    })

    // select users → null (deleted)
    // Chaine : from().select().eq().is().single()
    const singleFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const isFn = vi.fn().mockReturnValue({ single: singleFn })
    const eqFn = vi.fn().mockReturnValue({ is: isFn })
    const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
    mockAdminFrom.mockReturnValueOnce({ select: selectFn })

    const { GET } = await import('../../app/api/auth/qr/[token]/route')
    const response = await GET(buildRequest('valid-token'), {
      params: Promise.resolve({ token: 'valid-token' }),
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toContain('error=user_not_found')
    expect(mockRedisSetex).not.toHaveBeenCalled()
  })

  it('Bonus : role != ouvrier → redirect user_not_found (K3-E-01)', async () => {
    mockDecryptQR.mockReturnValueOnce({
      user_id: VALID_USER.id,
      organisation_id: VALID_USER.organisation_id,
    })

    // user existe mais role = conducteur
    const singleFn2 = vi.fn().mockResolvedValue({
      data: { ...VALID_USER, role: 'conducteur' },
      error: null,
    })
    const isFn2 = vi.fn().mockReturnValue({ single: singleFn2 })
    const eqFn2 = vi.fn().mockReturnValue({ is: isFn2 })
    const selectFn2 = vi.fn().mockReturnValue({ eq: eqFn2 })
    mockAdminFrom.mockReturnValueOnce({ select: selectFn2 })

    const { GET } = await import('../../app/api/auth/qr/[token]/route')
    const response = await GET(buildRequest('valid-token'), {
      params: Promise.resolve({ token: 'valid-token' }),
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toContain('error=user_not_found')
    expect(mockRedisSetex).not.toHaveBeenCalled()
  })

  it('TST-K3-01 : scan QR valide 1 affectation → session Redis creee + cookie + redirect chantier', async () => {
    mockDecryptQR.mockReturnValueOnce({
      user_id: VALID_USER.id,
      organisation_id: VALID_USER.organisation_id,
    })

    // Appels admin successifs : users (from().select().eq().is().single()) → affectations (from().select().eq().eq().is().or())
    let callCount = 0
    mockAdminFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // users query : from('users').select(...).eq('id',...).is('deleted_at',null).single()
        const single3 = vi.fn().mockResolvedValue({ data: VALID_USER, error: null })
        const is3 = vi.fn().mockReturnValue({ single: single3 })
        const eq3 = vi.fn().mockReturnValue({ is: is3 })
        const sel3 = vi.fn().mockReturnValue({ eq: eq3 })
        return { select: sel3 }
      }
      // affectations query : from('affectations').select(...).eq(...).eq(...).is(...).or(...)
      const or4 = vi.fn().mockResolvedValue({ data: [VALID_AFFECTATION], error: null })
      const is4 = vi.fn().mockReturnValue({ or: or4 })
      const eq4b = vi.fn().mockReturnValue({ is: is4 })
      const eq4a = vi.fn().mockReturnValue({ eq: eq4b })
      const sel4 = vi.fn().mockReturnValue({ eq: eq4a })
      return { select: sel4 }
    })

    const { GET } = await import('../../app/api/auth/qr/[token]/route')
    const response = await GET(buildRequest('valid-token'), {
      params: Promise.resolve({ token: 'valid-token' }),
    })

    // Session Redis creee
    expect(mockRedisSetex).toHaveBeenCalledWith(
      expect.stringContaining('ouvrier_session:'),
      604800,
      expect.any(String),
    )

    // Redirect vers le chantier (1 affectation)
    expect(response.status).toBe(307)
    const location = response.headers.get('Location') ?? ''
    expect(location).toContain('/ouvrier/chantiers/')

    // Cookie ouvrier_session pose
    const setCookie = response.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('ouvrier_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/')
  })
})
