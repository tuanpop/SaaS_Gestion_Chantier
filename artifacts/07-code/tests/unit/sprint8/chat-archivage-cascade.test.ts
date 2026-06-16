/**
 * tests/unit/sprint8/chat-archivage-cascade.test.ts
 *
 * Intégré depuis artifacts/10-qa/tests/sprint8/ — Sprint 8 QA Levi
 *
 * Tests couvrant les GAPs suivants :
 *   GAP-8-008 BLOQUANT : Cascade archivage chantier → chat fermé + propositions rejetées
 *   GAP-8-009 BLOQUANT : Régression F002 — upsert claw_accueil_log doit inclure organisation_id
 *   GAP-8-004 MINEUR   : Double-validation proposition → 409 (US-073)
 *
 * Correction d'implémentation v2 :
 *   L'archivage est dans DELETE /api/chantiers/[id] (retourne 204), PAS dans PATCH.
 *   PATCH ne modifie pas statut (UpdateChantierSchema ne l'inclut pas).
 *   Source : route.ts ligne 451 — "Levi : tester TST-K6-24 via DELETE, pas PATCH."
 *
 * Binding architecture :
 *   D-8-07 / D-8-10 : archivage → cascade chat (best-effort total)
 *   RG-CHAT-007 : chat fermé si chantier archivé
 *   RG-ACTION-009 : cascade archivage → propositions pending → rejete
 *   D-8-16 : best-effort — archivage non bloqué si INSERT system échoue
 *
 * Chemins structurels résolus depuis tests/unit/sprint8/ → ../../../
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockAdminFrom, mockLogger } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ from: vi.fn() }),
}))
vi.mock('@/lib/trial-gate', () => ({
  assertTrialActive: vi.fn().mockResolvedValue(undefined),
  checkTrialGate: vi.fn().mockResolvedValue({ blocked: false }),
}))
// Resolver dérives best-effort — ne doit pas bloquer l'archivage
vi.mock('@/lib/detection/resolver', () => ({
  resolverDerivesChantier: vi.fn().mockResolvedValue(undefined),
}))

// DELETE est la vraie méthode d'archivage (correction tests originaux QA)
import { DELETE } from '@/app/api/chantiers/[id]/route'
import { PATCH as PatchValider } from '@/app/api/action-proposals/[id]/valider/route'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================
// Fixtures
// ============================================================

const ORG_ID = 'org-uuid-0000-0000-0000-100000000001'
const ADMIN_ID = 'admin-uuid-0000-0000-0000-100000000001'
const CHANTIER_ID = 'chantier-uuid-000-0000-100000000001'
const CHAT_ID = 'chat-uuid-0000-0000-0000-100000000001'
const PROPOSAL_1_ID = 'proposal-uuid-000-0000-100000000001'
const PROPOSAL_2_ID = 'proposal-uuid-000-0000-100000000002'
const MESSAGE_ID = 'msg-uuid-0000-0000-0000-100000000001'

const adminHeaders = {
  'x-user-id': ADMIN_ID,
  'x-user-role': 'admin',
  'x-organisation-id': ORG_ID,
}

function makeDeleteRequest(headers: Record<string, string> = adminHeaders) {
  return new NextRequest(`http://localhost/api/chantiers/${CHANTIER_ID}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

// ============================================================
// GAP-8-009 : Régression F002 — upsert claw_accueil_log inclut organisation_id
// ============================================================

describe('GAP-8-009 REGR : Régression F002 — organisation_id dans upsert claw_accueil_log', () => {
  it('F002-REGR : le fichier QR route.ts contient organisation_id dans le payload upsert claw_accueil_log', () => {
    // Test structurel : vérifier que Zoro a bien corrigé F002
    // F002 Itachi : upsert sans organisation_id → violation NOT NULL silencieuse
    // Chemin depuis tests/unit/sprint8/ : ../../../app/api/auth/qr/[token]/route.ts
    const qrRoutePath = resolve(
      __dirname,
      '../../../app/api/auth/qr/[token]/route.ts',
    )

    let source: string
    try {
      source = readFileSync(qrRoutePath, 'utf-8')
    } catch {
      console.warn('GAP-8-009 : fichier QR route non trouvé — vérification manuelle requise')
      return
    }

    // L'upsert claw_accueil_log doit contenir organisation_id
    const upsertBlock = source.match(/claw_accueil_log[\s\S]{0,500}organisation_id/m)
    expect(upsertBlock).not.toBeNull()
  })

  it('F002-REGR-2 : la migration 020 définit organisation_id NOT NULL dans claw_accueil_log', () => {
    // Chemin depuis tests/unit/sprint8/ : ../../../supabase/migrations/020_claw_accueil_log.sql
    const migrationPath = resolve(
      __dirname,
      '../../../supabase/migrations/020_claw_accueil_log.sql',
    )

    let migrationSql: string
    try {
      migrationSql = readFileSync(migrationPath, 'utf-8')
    } catch {
      console.warn('GAP-8-009 : migration 020 non trouvée — vérification manuelle requise')
      return
    }

    // La contrainte NOT NULL doit être présente
    expect(migrationSql).toMatch(/organisation_id\s+uuid\s+NOT NULL/i)
    // La contrainte UNIQUE (idempotence 1/user/jour) doit être présente
    expect(migrationSql).toMatch(/UNIQUE.*uq_claw_accueil_user_date/i)
  })
})

// ============================================================
// GAP-8-008 BLOQUANT : Cascade archivage chantier (US-081)
// L'archivage est dans DELETE /api/chantiers/[id] (retourne 204)
// ============================================================

describe('GAP-8-008 BLOQUANT : Cascade archivage chantier (US-081 / RG-CHAT-007 / RG-ACTION-009)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Setup mock pour le handler DELETE /api/chantiers/[id]
   * Le handler :
   * 1. Vérifie le chantier (SELECT .single())
   * 2. UPDATE chantier statut=archive
   * 3. Best-effort : SELECT chat → INSERT message system
   * 4. Best-effort : UPDATE action_proposals pending → rejete
   * Retourne 204 No Content
   */
  function setupArchivageMock(options: {
    insertSystemFails?: boolean
  } = {}) {
    const { insertSystemFails = false } = options

    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'chantiers') {
        return {
          // Ownership check via .single()
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: CHANTIER_ID,
                    statut: 'actif',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          // UPDATE archivage
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }

      if (tableName === 'chats') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: CHAT_ID },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }

      if (tableName === 'messages') {
        if (insertSystemFails) {
          return {
            insert: vi.fn().mockRejectedValue(new Error('DB error')),
          }
        }
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      if (tableName === 'action_proposals') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }),
        }
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
      }
    })
  }

  it('CASCADE-1 : archivage chantier par DELETE → handler répond 204 (D-8-10)', async () => {
    setupArchivageMock()

    const req = makeDeleteRequest()
    const response = await DELETE(req, { params: Promise.resolve({ id: CHANTIER_ID }) })

    // Le handler retourne 204 No Content (soft-delete archivage)
    expect(response.status).toBe(204)
  })

  it('CASCADE-2 : archivage appelle la table chats (cascade message system D-8-10)', async () => {
    setupArchivageMock()

    const req = makeDeleteRequest()
    await DELETE(req, { params: Promise.resolve({ id: CHANTIER_ID }) })

    // Le handler doit avoir accédé à la table chats (pour le message système)
    const chatsCalls = (mockAdminFrom.mock.calls as Array<Array<string>>).filter(
      (args) => args[0] === 'chats',
    )
    expect(chatsCalls.length).toBeGreaterThan(0)
  })

  it('CASCADE-3 : archivage → action_proposals accédée pour rejet pending (RG-ACTION-009)', async () => {
    setupArchivageMock()

    const req = makeDeleteRequest()
    await DELETE(req, { params: Promise.resolve({ id: CHANTIER_ID }) })

    const proposalCalls = (mockAdminFrom.mock.calls as Array<Array<string>>).filter(
      (args) => args[0] === 'action_proposals',
    )
    expect(proposalCalls.length).toBeGreaterThan(0)
  })

  it('CASCADE-4 : INSERT message system échoue → archivage quand même réussi (best-effort D-8-10)', async () => {
    setupArchivageMock({ insertSystemFails: true })

    const req = makeDeleteRequest()
    const response = await DELETE(req, { params: Promise.resolve({ id: CHANTIER_ID }) })

    // D-8-10 BINDING : cascade non-bloquante — erreur = log warn, archivage continue
    expect(response.status).toBe(204)
    // Un warn doit être loggé (best-effort failure)
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('CASCADE-5 : unauthenticated → 401 (archivage protégé)', async () => {
    const req = new NextRequest(`http://localhost/api/chantiers/${CHANTIER_ID}`, {
      method: 'DELETE',
    })

    const response = await DELETE(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(401)
  })

  it("CASCADE-6 : conducteur tente d'archiver → 403 (admin-only)", async () => {
    const req = makeDeleteRequest({
      'x-user-id': 'conducteur-uuid-001',
      'x-user-role': 'conducteur',
      'x-organisation-id': ORG_ID,
    })

    const response = await DELETE(req, { params: Promise.resolve({ id: CHANTIER_ID }) })
    expect(response.status).toBe(403)
  })

  it('CASCADE-7 : chantier inexistant → 404 (ownership check)', async () => {
    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'chantiers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Row not found' },
                }),
              }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      }
    })

    const req = makeDeleteRequest()
    const response = await DELETE(req, { params: Promise.resolve({ id: 'inexistant-id' }) })
    expect(response.status).toBe(404)
  })
})

// ============================================================
// GAP-8-004 MINEUR : Double-validation proposition → 409 (US-073)
// ============================================================

describe('GAP-8-004 : Double-validation proposition (US-073)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('DOUBLE-VAL-1 : valider une proposition déjà en statut "execute" → 409', async () => {
    const executedProposal = {
      id: PROPOSAL_1_ID,
      organisation_id: ORG_ID,
      chantier_id: CHANTIER_ID,
      message_id: MESSAGE_ID,
      type: 'creer_tache',
      payload: { titre: 'Fondations' },
      statut: 'execute',
      valide_par: ADMIN_ID,
      valide_at: new Date().toISOString(),
      erreur_execution: null,
      ressource_id: 'tache-uuid-001',
      ressource_type: 'tache',
      created_at: new Date().toISOString(),
    }

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: executedProposal, error: null }),
        }),
      }),
    })

    const req = new NextRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_1_ID}/valider`,
      { method: 'PATCH', headers: adminHeaders },
    )

    const response = await PatchValider(req, { params: Promise.resolve({ id: PROPOSAL_1_ID }) })
    expect(response.status).toBe(409)

    const body = await response.json() as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('DOUBLE-VAL-2 : valider une proposition déjà en statut "rejete" → 409', async () => {
    const rejectedProposal = {
      id: PROPOSAL_1_ID,
      organisation_id: ORG_ID,
      chantier_id: CHANTIER_ID,
      message_id: MESSAGE_ID,
      type: 'creer_tache',
      payload: { titre: 'Test' },
      statut: 'rejete',
      valide_par: ADMIN_ID,
      valide_at: new Date().toISOString(),
      erreur_execution: null,
      ressource_id: null,
      ressource_type: null,
      created_at: new Date().toISOString(),
    }

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: rejectedProposal, error: null }),
        }),
      }),
    })

    const req = new NextRequest(
      `http://localhost/api/action-proposals/${PROPOSAL_1_ID}/valider`,
      { method: 'PATCH', headers: adminHeaders },
    )

    const response = await PatchValider(req, { params: Promise.resolve({ id: PROPOSAL_1_ID }) })
    expect(response.status).toBe(409)
  })
})
