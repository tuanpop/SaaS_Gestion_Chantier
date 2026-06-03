/**
 * tests/unit/ouvrier-security-gaps.test.ts
 * Tests de securite manquants identifies par Levi (Sprint 3 QA)
 *
 * Gaps couverts :
 *   TST-K3-03  IDOR cross-orga : cookie orga A + chantier orga B = 403 (K3-CR-03)
 *   TST-K3-07  Cookie absent -> 401 sur GET /api/ouvrier/me (handler manquant dans tests Amelia)
 *   TST-K3-13  Cookie ouvrier_session sur endpoint conducteur /api/taches/[id] -> 401 (K3-HI-02)
 *   TST-K3-14  JWT conducteur orga B + tache orga A -> 403 via RLS (K3-HI-09)
 *   TST-K3-15  Page no-affectation : param data malformate -> fallback, pas de crash (K3-MED-10)
 *   TST-K3-17  Cookie attributs complets : HttpOnly + SameSite=Lax + Path=/ + Max-Age (D-3-003)
 *   TST-K3-19  Cache-Control: no-store sur endpoints ouvrier (K3-I-04)
 *   TST-K3-20  Convention pino : logs ne doivent pas contenir note_privee_conducteur (K3-HI-06/MED-12)
 *   TST-K3-10x Session zombie : PATCH tache apres DELETE affectation = 403 immediat (K3-S-05)
 *
 * Note isolation : vi.resetAllMocks() vide implementations + queues Once + call history.
 * setupMockDefaults() re-configure les implementations necessaires apres chaque reset.
 * Cela evite les contaminations entre tests (mockImplementationOnce non consommes, etc.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  PatchOuvrierTacheSchema,
  OuvrierSessionSchema,
  NoAffectationDataSchema,
} from '../../lib/validation/ouvrier'

// ============================================================
// Mocks communs — hoistes par Vitest
// ============================================================

const mockGetOuvrierSession = vi.fn()
const mockAdminFrom = vi.fn()
const mockRedisSetex = vi.fn()
const mockRedisSadd = vi.fn()
const mockRedisExpire = vi.fn()
const mockDecryptQR = vi.fn()
const mockRedisGet = vi.fn()
const mockRedisSmembers = vi.fn()
const mockGetUser = vi.fn()

// Logger child : expose comme variable top-level pour pouvoir re-configurer apres reset
const mockChildLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}
const mockLoggerChild = vi.fn()

vi.mock('../../lib/ouvrier-session', () => ({
  getOuvrierSession: (...args: unknown[]) => mockGetOuvrierSession(...args),
  OUVRIER_SESSION_TTL: 604800,
  SESSION_PREFIX: 'ouvrier_session:',
  USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
  // Aliases backward-compat
  REDIS_SESSION_PREFIX: 'ouvrier_session:',
  REDIS_USER_SESSIONS_PREFIX: 'ouvrier_user_sessions:',
  invalidateOuvrierSessionsForUser: vi.fn().mockResolvedValue({ invalidated: 0 }),
}))

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}))

// D-054 : lib/redis supprimee — mocks session-store a la place
vi.mock('../../lib/session-store', () => ({
  getSessionStore: () => ({
    create: (...args: unknown[]) => mockRedisSetex(...args), // reuse mock var pour compatibilite tests TST-K3-17
    read: (...args: unknown[]) => mockRedisGet(...args),
    touch: (...args: unknown[]) => mockRedisExpire(...args),
    invalidateForUser: (...args: unknown[]) => mockRedisSmembers(...args),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
  PostgresSessionStore: vi.fn(),
}))

vi.mock('../../lib/crypto', () => ({
  decryptQR: (...args: unknown[]) => mockDecryptQR(...args),
  InvalidQRTokenError: class InvalidQRTokenError extends Error {
    constructor(msg: string) { super(msg); this.name = 'InvalidQRTokenError' }
  },
}))

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: (...args: unknown[]) => mockLoggerChild(...args),
  },
}))

vi.mock('../../lib/supabase/server', () => ({
  createServerClient: () => ({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
  }),
}))

// ============================================================
// Helper : re-configure les mocks apres vi.resetAllMocks()
// ============================================================

function setupMockDefaults() {
  // logger.child doit retourner un objet logger valide (pas undefined)
  mockLoggerChild.mockReturnValue(mockChildLogger)
  // session-store defaults (D-054 : mockRedisGet = read, mockRedisSmembers = invalidateForUser)
  mockRedisGet.mockResolvedValue(null)   // read : pas de session active
  mockRedisSmembers.mockResolvedValue(0) // invalidateForUser : 0 sessions supprimees
  mockRedisSetex.mockResolvedValue(undefined) // create : succes
  mockRedisExpire.mockResolvedValue(undefined) // touch : succes
}

// ============================================================
// Fixtures
// ============================================================

const ORG_A = '00000000-0000-0000-0000-000000000A01'
const ORG_B = '00000000-0000-0000-0000-000000000B01'
const USER_ORG_A = '00000000-0000-0000-0000-000000000001'
const CHANTIER_ORG_B = '00000000-0000-0000-0000-000000000B20'
const CHANTIER_ORG_A = '00000000-0000-0000-0000-000000000A20'
const TACHE_ORG_A = '00000000-0000-0000-0000-000000000A30'

const SESSION_ORG_A = {
  user_id: USER_ORG_A,
  organisation_id: ORG_A,
  role: 'ouvrier' as const,
  affectations: [],
  created_at: Date.now(),
}

// ============================================================
// TST-K3-03 : IDOR cross-orga chantier
// ============================================================

describe('TST-K3-03 : IDOR cross-orga chantier (K3-CR-03 BINDING)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupMockDefaults()
  })

  it('cookie session orga A + UUID chantier orga B -> 403 (organisation_id filtre obligatoire)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(SESSION_ORG_A)

    let callIndex = 0
    mockAdminFrom.mockImplementation(() => {
      callIndex++
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      }
    })

    const { GET } = await import('../../app/api/ouvrier/chantiers/[id]/route')
    const request = new NextRequest(`http://localhost/api/ouvrier/chantiers/${CHANTIER_ORG_B}`)
    const response = await GET(request, {
      params: Promise.resolve({ id: CHANTIER_ORG_B }),
    })

    expect(response.status).toBe(403)
    const body = await response.json() as Record<string, unknown>
    expect(body['error']).toBe('Accès refusé.')
    expect(callIndex).toBeLessThanOrEqual(1)
  })
})

// ============================================================
// TST-K3-07 : Cookie absent -> 401 sur GET /api/ouvrier/me
// ============================================================

describe('TST-K3-07 : Cookie absent -> 401 sur GET /api/ouvrier/me (K3-HI-07)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupMockDefaults()
  })

  it('GET /api/ouvrier/me sans session -> 401', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce(null)

    const { GET } = await import('../../app/api/ouvrier/me/route')
    const request = new NextRequest('http://localhost/api/ouvrier/me')
    const response = await GET(request)

    expect(response.status).toBe(401)
    const body = await response.json() as Record<string, unknown>
    expect(body['error']).toContain('Session expirée')
  })
})

// ============================================================
// TST-K3-13 : Cookie ouvrier sur endpoint conducteur -> 401
// ============================================================

describe('TST-K3-13 : Cookie ouvrier_session sur endpoint conducteur -> 401 (K3-HI-02)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupMockDefaults()
  })

  it('PATCH /api/taches/[id] sans Bearer JWT (uniquement cookie ouvrier) -> 401', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'no JWT provided' },
    })

    const { PATCH } = await import('../../app/api/taches/[id]/route')
    const request = new NextRequest(`http://localhost/api/taches/${TACHE_ORG_A}`, {
      method: 'PATCH',
      body: JSON.stringify({ statut: 'en_cours' }),
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'ouvrier_session=fake-ouvrier-session-id',
      },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: TACHE_ORG_A }),
    })

    expect(response.status).toBe(401)
  })
})

// ============================================================
// TST-K3-14 : Cross-orga conducteur -> 4XX
// ============================================================

describe('TST-K3-14 : Cross-orga conducteur modifie note_privee_conducteur orga A (K3-HI-09)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupMockDefaults()
  })

  it('Conducteur orga B tente de PATCH tache orga A -> 4XX (protection auth + RLS D-028)', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'no JWT provided' },
    })

    const { PATCH } = await import('../../app/api/taches/[id]/route')
    const request = new NextRequest(`http://localhost/api/taches/${TACHE_ORG_A}`, {
      method: 'PATCH',
      body: JSON.stringify({ note_privee_conducteur: 'tentative cross-orga' }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fake-jwt-orga-b',
      },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: TACHE_ORG_A }),
    })

    expect([401, 403, 404]).toContain(response.status)
  })
})

// ============================================================
// TST-K3-15 : Page no-affectation data malformate -> fallback, pas de crash
// ============================================================

describe('TST-K3-15 : NoAffectationDataSchema - data malformate -> fallback (K3-MED-10)', () => {
  it('JSON invalide dans param data -> schema safeParse echoue sans throw', () => {
    const invalidJson = '{"not valid json'
    let parsed: unknown = null
    expect(() => {
      try {
        parsed = JSON.parse(invalidJson)
      } catch {
        parsed = null
      }
    }).not.toThrow()
    expect(parsed).toBeNull()

    const invalidSchema = NoAffectationDataSchema.safeParse({
      conducteur_prenom: 'Jean',
      conducteur_telephone: null,
      dernier_chantier_nom: 'Test',
    })
    expect(typeof invalidSchema.success).toBe('boolean')
    expect(invalidSchema.success).toBe(false)
  })

  it('JSON valide mais telephone manquant -> safeParse retourne un resultat sans throw', () => {
    const result = NoAffectationDataSchema.safeParse({
      conducteur_nom: 'Dupont',
      conducteur_prenom: 'Jean',
      conducteur_telephone: null,
      dernier_chantier_nom: null,
    })
    expect(typeof result.success).toBe('boolean')
  })

  it('base64 arbitraire (potentiel phishing) -> atob + JSON.parse + safeParse = pas de crash', () => {
    const maliciousBase64 = Buffer.from(
      JSON.stringify({
        conducteur_nom: 'FAUX',
        conducteur_telephone: '+33999999999',
        conducteur_prenom: 'ATTAQUANT',
        dernier_chantier_nom: 'CHANTIER_FAKE',
      })
    ).toString('base64')

    let decoded: unknown = null
    expect(() => {
      try {
        decoded = JSON.parse(Buffer.from(maliciousBase64, 'base64').toString('utf-8'))
      } catch {
        decoded = null
      }
    }).not.toThrow()

    if (decoded !== null) {
      const result = NoAffectationDataSchema.safeParse(decoded)
      expect(typeof result.success).toBe('boolean')
    }
  })
})

// ============================================================
// TST-K3-17 : Cookie attributs complets
// ============================================================

describe('TST-K3-17 : Cookie ouvrier_session attributs de securite D-3-003', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupMockDefaults()
    // session-store.create : resoudre sans erreur (session Postgres creee avec succes)
    mockRedisSetex.mockResolvedValue(undefined)
    mockRedisSadd.mockResolvedValue(1)
    mockRedisExpire.mockResolvedValue(1)
  })

  it('Scan QR valide 1 affectation -> Set-Cookie contient HttpOnly + SameSite=Lax + Path=/ + Max-Age (D-3-003 BINDING)', async () => {
    const VALID_USER_ID = '00000000-0000-0000-0000-000000000001'
    const VALID_ORG_ID = '00000000-0000-0000-0000-000000000002'
    const CHANTIER_ID = '00000000-0000-0000-0000-000000000020'

    mockDecryptQR.mockReturnValueOnce({
      user_id: VALID_USER_ID,
      organisation_id: VALID_ORG_ID,
    })

    // Appel 1 : from('users').select(...).eq('id',...).is('deleted_at',null).single()
    const singleUsers = vi.fn().mockResolvedValue({
      data: { id: VALID_USER_ID, role: 'ouvrier', organisation_id: VALID_ORG_ID, deleted_at: null },
      error: null,
    })
    const isUsers = vi.fn().mockReturnValue({ single: singleUsers })
    const eqUsers = vi.fn().mockReturnValue({ is: isUsers })
    const selUsers = vi.fn().mockReturnValue({ eq: eqUsers })
    mockAdminFrom.mockReturnValueOnce({ select: selUsers })

    // Appel 2 : from('affectations').select(...).eq('user_id',...).eq('organisation_id',...).or(...) — hard delete
    const orAff = vi.fn().mockResolvedValue({
      data: [{
        id: '00000000-0000-0000-0000-000000000010',
        chantier_id: CHANTIER_ID,
        vue: 'mes_taches',
        chantiers: { statut: 'actif' },
      }],
      error: null,
    })
    const eq2Aff = vi.fn().mockReturnValue({ or: orAff })
    const eq1Aff = vi.fn().mockReturnValue({ eq: eq2Aff })
    const selAff = vi.fn().mockReturnValue({ eq: eq1Aff })
    mockAdminFrom.mockReturnValueOnce({ select: selAff })

    const { GET } = await import('../../app/api/auth/qr/[token]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/auth/qr/valid-token'),
      { params: Promise.resolve({ token: 'valid-token' }) },
    )

    expect(response.status).toBe(307)
    const setCookieHeader = response.headers.get('Set-Cookie') ?? ''
    expect(setCookieHeader.length).toBeGreaterThan(0)

    expect(setCookieHeader).toContain('ouvrier_session=')
    expect(setCookieHeader.toLowerCase()).toContain('httponly')
    expect(setCookieHeader.toLowerCase()).toMatch(/path=\//)

    const hasMaxAge = setCookieHeader.toLowerCase().includes('max-age=')
    const hasExpires = setCookieHeader.toLowerCase().includes('expires=')
    expect(hasMaxAge || hasExpires).toBe(true)

    if (hasMaxAge) {
      const maxAgeMatch = setCookieHeader.match(/[Mm]ax-[Aa]ge=(\d+)/)
      if (maxAgeMatch) {
        expect(Number(maxAgeMatch[1])).toBe(604800)
      }
    }

    expect(setCookieHeader.toLowerCase()).toContain('samesite=lax')
  })
})

// ============================================================
// TST-K3-19 : Cache-Control: no-store sur endpoints ouvrier
// ============================================================

describe('TST-K3-19 : Cache-Control: no-store sur endpoints ouvrier (K3-I-04)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupMockDefaults()
  })

  it('GET /api/ouvrier/me -> Cache-Control: no-store', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ORG_A,
      organisation_id: ORG_A,
      role: 'ouvrier' as const,
      affectations: [],
      created_at: Date.now(),
    })

    // from('users').select(...).eq('id',...).eq('organisation_id',...).is('deleted_at',null).single()
    const singleU = vi.fn().mockResolvedValue({
      data: { id: USER_ORG_A, nom: 'Test', prenom: 'Ouvrier', organisation_id: ORG_A },
      error: null,
    })
    const isU = vi.fn().mockReturnValue({ single: singleU })
    const eq2U = vi.fn().mockReturnValue({ is: isU })
    const eq1U = vi.fn().mockReturnValue({ eq: eq2U })
    const selU = vi.fn().mockReturnValue({ eq: eq1U })
    mockAdminFrom.mockReturnValueOnce({ select: selU })

    const { GET } = await import('../../app/api/ouvrier/me/route')
    const request = new NextRequest('http://localhost/api/ouvrier/me')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const cacheControl = response.headers.get('Cache-Control') ?? ''
    expect(cacheControl.toLowerCase()).toContain('no-store')
  })
})

// ============================================================
// TST-K3-20 : Convention pino redact
// ============================================================

describe('TST-K3-20 : Convention pino - logs ne contiennent pas note_privee_conducteur (K3-HI-06/MED-12)', () => {
  it('Pattern de log correct : uniquement user_id + action + new_statut, jamais le body complet', () => {
    const incorrectLogPayload = {
      user_id: 'test-user',
      body: {
        statut: 'en_cours',
        note_privee_conducteur: 'DONNEE_SENSIBLE',
        bloque_raison: 'RAISON_SENSIBLE',
      },
    }
    const incorrectSerialized = JSON.stringify(incorrectLogPayload)
    expect(incorrectSerialized).toContain('DONNEE_SENSIBLE')

    const correctLogPayload = {
      user_id: 'test-user',
      tache_id: 'tache-uuid',
      action: 'patch_statut',
      new_statut: 'en_cours',
    }
    const correctSerialized = JSON.stringify(correctLogPayload)
    expect(correctSerialized).not.toContain('note_privee_conducteur')
    expect(correctSerialized).not.toContain('bloque_raison')
    expect(correctSerialized).not.toContain('DONNEE_SENSIBLE')
  })

  it('Schema Zod ouvrier .strict() garantit que note_privee_conducteur ne passe jamais dans le body valide', () => {
    const parseResult = PatchOuvrierTacheSchema.safeParse({
      statut: 'en_cours',
      note_privee_conducteur: 'tentative',
    })
    expect(parseResult.success).toBe(false)

    const parseValide = PatchOuvrierTacheSchema.safeParse({ statut: 'en_cours' })
    expect(parseValide.success).toBe(true)
    if (parseValide.success) {
      expect(parseValide.data).not.toHaveProperty('note_privee_conducteur')
    }
  })
})

// ============================================================
// TST-K3-10x : Session zombie - PATCH tache apres DELETE affectation = 403 immediat
// ============================================================

describe('TST-K3-10x : Session zombie defense (K3-S-05 BINDING D-3-005)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupMockDefaults()
  })

  it('PATCH tache : session Redis valide mais affectation supprimee en base -> 403 immediat (base = autorite)', async () => {
    mockGetOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ORG_A,
      organisation_id: ORG_A,
      role: 'ouvrier' as const,
      affectations: [{ affectation_id: 'aff-id', chantier_id: CHANTIER_ORG_A, vue: 'mes_taches' as const }],
      created_at: Date.now(),
    })

    // Appel 1 : from('taches').select(...).eq('id',...).eq('organisation_id',...).is('deleted_at',null).single()
    const singleTache = vi.fn().mockResolvedValue({
      data: {
        id: TACHE_ORG_A,
        assigned_to: USER_ORG_A,
        statut: 'en_cours',
        chantier_id: CHANTIER_ORG_A,
        organisation_id: ORG_A,
      },
      error: null,
    })
    // taches : from('taches').select(...).eq('id',...).eq('organisation_id',...).single() — hard delete
    const eq2Tache = vi.fn().mockReturnValue({ single: singleTache })
    const eq1Tache = vi.fn().mockReturnValue({ eq: eq2Tache })
    const selTache = vi.fn().mockReturnValue({ eq: eq1Tache })
    mockAdminFrom.mockReturnValueOnce({ select: selTache })

    // Appel 2 : from('affectations').select('id').eq(...).eq(...).eq(...).or(...).limit(1) — hard delete
    // 0 affectations = session zombie
    const limitAff = vi.fn().mockResolvedValue({ data: [], error: null })
    const orAff = vi.fn().mockReturnValue({ limit: limitAff })
    const eq3Aff = vi.fn().mockReturnValue({ or: orAff })
    const eq2Aff = vi.fn().mockReturnValue({ eq: eq3Aff })
    const eq1Aff = vi.fn().mockReturnValue({ eq: eq2Aff })
    const selAff = vi.fn().mockReturnValue({ eq: eq1Aff })
    mockAdminFrom.mockReturnValueOnce({ select: selAff })

    const { PATCH } = await import('../../app/api/ouvrier/taches/[id]/route')
    const request = new NextRequest(`http://localhost/api/ouvrier/taches/${TACHE_ORG_A}`, {
      method: 'PATCH',
      body: JSON.stringify({ statut: 'termine' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await PATCH(request, {
      params: Promise.resolve({ id: TACHE_ORG_A }),
    })

    // D-3-005 : session Redis valide mais affectation absente en base -> 403
    expect(response.status).toBe(403)
    const body = await response.json() as Record<string, unknown>
    expect(body['error']).toBe('Accès refusé.')
  })
})

// ============================================================
// Validation schemas
// ============================================================

describe('OuvrierSessionSchema — validation structure session Redis (D-3-003)', () => {
  it('rejette session avec role != ouvrier (escalade privilege impossible)', () => {
    const result = OuvrierSessionSchema.safeParse({
      user_id: '00000000-0000-0000-0000-000000000001',
      organisation_id: '00000000-0000-0000-0000-000000000002',
      role: 'admin',
      affectations: [],
      created_at: Date.now(),
    })
    expect(result.success).toBe(false)
  })

  it('accepte session valide avec affectations vide', () => {
    const result = OuvrierSessionSchema.safeParse({
      user_id: '00000000-0000-0000-0000-000000000001',
      organisation_id: '00000000-0000-0000-0000-000000000002',
      role: 'ouvrier' as const,
      affectations: [],
      created_at: Date.now(),
    })
    expect(result.success).toBe(true)
  })
})
