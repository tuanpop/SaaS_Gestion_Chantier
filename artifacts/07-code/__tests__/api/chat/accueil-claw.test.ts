/**
 * __tests__/api/chat/accueil-claw.test.ts
 *
 * Tests GET /api/ouvrier/accueil-claw
 *
 * D-8-16 BINDING : best-effort — aucun 5xx — toujours { accueil: null } sur erreur
 * D-051 BINDING : note_privee_conducteur absente de la réponse
 * RG-ACCUEIL-006 : unicité user_id + date_accueil (row lue si présente)
 * RG-ACCUEIL-007 : llm_utilise=false si trial fallback (retourné dans réponse)
 * Cookie ouvrier uniquement (JWT admin → 401)
 *
 * Cas couverts :
 *   AC-1 : session ouvrier + row du jour présente → 200 + accueil
 *   AC-2 : session ouvrier + row absente → 200 + {accueil: null}
 *   AC-3 : pas de session → 401
 *   AC-4 : erreur DB lecture → 200 + {accueil: null} (D-8-16 best-effort)
 *   AC-5 : exception inattendue → 200 + {accueil: null} (D-8-16)
 *   AC-6 : chantier hors org (cross-org) → 200 + {accueil: null}
 *   AC-7 : réponse ne contient JAMAIS note_privee_conducteur (D-051 structurel)
 *   AC-8 : llm_utilise retourné tel quel (false pour fallback, true pour LLM)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockAdminFrom, mockLogger, mockOuvrierSession } = vi.hoisted(() => {
  return {
    mockAdminFrom: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    mockOuvrierSession: vi.fn(),
  }
})

vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/ouvrier-session', () => ({ getOuvrierSession: mockOuvrierSession }))

import { GET } from '@/app/api/ouvrier/accueil-claw/route'
import { NextRequest } from 'next/server'

// ============================================================
// Fixtures
// ============================================================

const USER_ID = 'ouvrier-uuid-0000-0000-000000000001'
const ORG_ID = 'org-uuid-0000-0000-0000-000000000001'
const CHANTIER_ID = 'chantier-uuid-000-0000-000000000001'

const TODAY = new Date().toISOString().split('T')[0]!

const accueilRowFixture = {
  id: 'accueil-row-001',
  user_id: USER_ID,
  chantier_id: CHANTIER_ID,
  date_accueil: TODAY,
  contenu: 'Bonjour Jean ! Voici ton planning du jour...',
  meteo_disponible: true,
  llm_utilise: true,
  created_at: new Date().toISOString(),
}

const chantierRowFixture = { id: CHANTIER_ID }

function makeRequest() {
  return new NextRequest('http://localhost/api/ouvrier/accueil-claw', {
    method: 'GET',
  })
}

// Helper : setup mock adminFrom pour retourner accueil + chantier
function setupAdminMock(accueilData: unknown, chantierData: unknown = chantierRowFixture, accueilError: unknown = null) {
  let callIndex = 0
  mockAdminFrom.mockImplementation((tableName: string) => {
    if (tableName === 'claw_accueil_log') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: accueilData, error: accueilError }),
            }),
          }),
        }),
      }
    }
    if (tableName === 'chantiers') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: chantierData, error: null }),
            }),
          }),
        }),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })
}

// ============================================================
// Tests
// ============================================================

describe('GET /api/ouvrier/accueil-claw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('AC-1 : session ouvrier + row du jour présente → 200 + accueil (happy path)', async () => {
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ID,
      organisation_id: ORG_ID,
    })
    setupAdminMock(accueilRowFixture)

    const response = await GET(makeRequest())
    expect(response.status).toBe(200)

    const body = await response.json() as { accueil: Record<string, unknown> | null }
    expect(body.accueil).not.toBeNull()
    expect(body.accueil?.['contenu']).toBe(accueilRowFixture.contenu)
    expect(body.accueil?.['meteo_disponible']).toBe(true)
    expect(body.accueil?.['llm_utilise']).toBe(true)
    expect(body.accueil?.['date_accueil']).toBe(TODAY)
  })

  it('AC-2 : row absente → 200 + {accueil: null} (scan QR non effectué)', async () => {
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ID,
      organisation_id: ORG_ID,
    })
    setupAdminMock(null) // Pas de row

    const response = await GET(makeRequest())
    expect(response.status).toBe(200)

    const body = await response.json() as { accueil: null }
    expect(body.accueil).toBeNull()
  })

  it('AC-3 : pas de session ouvrier → 401', async () => {
    mockOuvrierSession.mockResolvedValueOnce(null)

    const response = await GET(makeRequest())
    expect(response.status).toBe(401)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('Session')
  })

  it('AC-4 : erreur DB lecture → 200 + {accueil: null} (D-8-16 best-effort)', async () => {
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ID,
      organisation_id: ORG_ID,
    })
    // Erreur DB sur la lecture
    setupAdminMock(null, null, { message: 'DB connection refused' })

    const response = await GET(makeRequest())

    // D-8-16 BINDING : jamais 5xx — retourner null silencieusement
    expect(response.status).toBe(200)
    const body = await response.json() as { accueil: null }
    expect(body.accueil).toBeNull()
  })

  it('AC-5 : exception inattendue → 200 + {accueil: null} (D-8-16 catch global)', async () => {
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ID,
      organisation_id: ORG_ID,
    })
    // AdminFrom throw
    mockAdminFrom.mockImplementation(() => {
      throw new Error('Unexpected crash')
    })

    const response = await GET(makeRequest())

    // D-8-16 : catch global → retour null, jamais 5xx
    expect(response.status).toBe(200)
    const body = await response.json() as { accueil: null }
    expect(body.accueil).toBeNull()
  })

  it('AC-6 : chantier hors organisation (cross-org) → 200 + {accueil: null}', async () => {
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ID,
      organisation_id: ORG_ID,
    })
    // Accueil présent mais chantier hors org
    setupAdminMock(accueilRowFixture, null) // chantierData = null → hors org

    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    const body = await response.json() as { accueil: null }
    expect(body.accueil).toBeNull()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      expect.stringContaining('hors organisation'),
    )
  })

  it('AC-7 : réponse ne contient JAMAIS note_privee_conducteur (D-051 structurel)', async () => {
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ID,
      organisation_id: ORG_ID,
    })
    setupAdminMock(accueilRowFixture)

    const response = await GET(makeRequest())
    const body = await response.json() as Record<string, unknown>

    // D-051 BINDING : note_privee_conducteur absent structurellement
    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain('note_privee_conducteur')
    expect(bodyStr).not.toContain('note_privee')

    // Les champs accueil autorisés
    if (body['accueil'] && typeof body['accueil'] === 'object') {
      const accueil = body['accueil'] as Record<string, unknown>
      expect(Object.keys(accueil)).toEqual(
        expect.arrayContaining(['contenu', 'meteo_disponible', 'llm_utilise', 'date_accueil']),
      )
      expect('note_privee_conducteur' in accueil).toBe(false)
    }
  })

  it('AC-8 : llm_utilise=false (trial fallback) → retourné tel quel (RG-ACCUEIL-007)', async () => {
    const fallbackRow = { ...accueilRowFixture, llm_utilise: false, meteo_disponible: false }
    mockOuvrierSession.mockResolvedValueOnce({
      user_id: USER_ID,
      organisation_id: ORG_ID,
    })
    setupAdminMock(fallbackRow)

    const response = await GET(makeRequest())
    expect(response.status).toBe(200)

    const body = await response.json() as { accueil: Record<string, unknown> }
    expect(body.accueil?.['llm_utilise']).toBe(false)
    expect(body.accueil?.['meteo_disponible']).toBe(false)
  })
})
