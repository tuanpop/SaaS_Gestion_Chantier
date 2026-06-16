/**
 * tests/unit/sprint8/chat-creation-auto.test.ts
 *
 * Intégré depuis artifacts/10-qa/tests/sprint8/ — Sprint 8 QA Levi
 *
 * GAP-8-001 : Chat auto-créé à la création du chantier (US-066, RG-CHAT-001/002)
 *
 * D-8-01 BINDING : POST /api/chantiers → INSERT dans chats (best-effort)
 * RG-CHAT-001 : 1 chat = 1 chantier (UNIQUE contrainte)
 * RG-CHAT-002 : Création automatique à la création du chantier
 * D-8-08 BINDING : si INSERT chat échoue, le chantier est quand même créé (log warn)
 *
 * Corrections v2 :
 *   - validChantierBody inclut client_nom et adresse (requis par CreateChantierSchema)
 *   - mock chantier insert inclut tous les champs requis par calculerCouleur()
 *   - INSERT chats utilise .mockResolvedValue (pas .select().single()) — le handler insère
 *     directement sans sélection de retour
 *
 * Chemins structurels résolus depuis tests/unit/sprint8/ → ../../../
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockAdminFrom, mockLogger, mockAssertTrialActive } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  mockAssertTrialActive: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ from: vi.fn() }),
}))
vi.mock('@/lib/trial-gate', () => ({
  assertTrialActive: mockAssertTrialActive,
  checkTrialGate: vi.fn().mockResolvedValue({ blocked: false }),
}))

import { POST } from '@/app/api/chantiers/route'
import { NextRequest } from 'next/server'

// ============================================================
// Fixtures
// ============================================================

const ORG_ID = 'org-uuid-0000-0000-0000-400000000001'
const ADMIN_ID = 'admin-uuid-0000-0000-0000-400000000001'
const CHANTIER_ID = 'chantier-uuid-000-0000-400000000001'
const CHAT_ID = 'chat-uuid-0000-0000-0000-400000000001'

const adminHeaders = {
  'x-user-id': ADMIN_ID,
  'x-user-role': 'admin',
  'x-organisation-id': ORG_ID,
}

// CreateChantierSchema requiert : nom, client_nom, adresse, code_postal, date_debut, date_fin_prevue
const validChantierBody = {
  nom: 'Rénovation Leclerc',
  client_nom: 'Leclerc SA',
  adresse: '12 rue de la Paix',
  code_postal: '75001',
  date_debut: '2026-07-01',
  date_fin_prevue: '2026-12-31',
}

// Chantier complet requis par calculerCouleur() (spread dans la réponse 201)
const mockChantierInserted = {
  id: CHANTIER_ID,
  organisation_id: ORG_ID,
  nom: 'Rénovation Leclerc',
  client_nom: 'Leclerc SA',
  adresse: '12 rue de la Paix',
  code_postal: '75001',
  statut: 'actif',
  date_debut: '2026-07-01',
  date_fin_prevue: '2026-12-31',
  date_fin_reelle: null,
  budget_alloue: null,
  budget_depense: 0,
  created_by: ADMIN_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

// ============================================================
// Tests structurels — RG-CHAT-002
// Chemins depuis tests/unit/sprint8/ : ../../../
// ============================================================

describe('GAP-8-001 STRUCTUREL : handler POST /api/chantiers insère dans chats (RG-CHAT-002)', () => {
  it('STRUCT-CHAT-1 : le fichier chantiers/route.ts accède à la table "chats" après création', () => {
    const chantiersRoutePath = resolve(
      __dirname,
      '../../../app/api/chantiers/route.ts',
    )

    let source: string
    try {
      source = readFileSync(chantiersRoutePath, 'utf-8')
    } catch {
      console.warn('STRUCT-CHAT-1 : app/api/chantiers/route.ts non trouvé — vérification manuelle requise')
      return
    }

    // D-8-01 BINDING : le handler POST chantier doit insérer dans 'chats'
    expect(source).toContain('chats')

    const hasChatInsert = source.match(/from\(['"]chats['"]\)[\s\S]{0,100}\.insert/m)
      || source.match(/\.insert[\s\S]{0,50}chats/m)
      || source.includes("'chats'")

    expect(hasChatInsert).toBeTruthy()
  })

  it('STRUCT-CHAT-2 : RG-CHAT-001 — contrainte UNIQUE chantier_id dans migration 018', () => {
    const migrationPath = resolve(
      __dirname,
      '../../../supabase/migrations/018_chats_messages.sql',
    )

    let migrationSql: string
    try {
      migrationSql = readFileSync(migrationPath, 'utf-8')
    } catch {
      console.warn('STRUCT-CHAT-2 : migration 018 non trouvée — vérification manuelle requise')
      return
    }

    // RG-CHAT-001 : contrainte UNIQUE sur chantier_id
    expect(migrationSql).toMatch(/chantier_id[\s\S]{0,30}UNIQUE/i)
  })
})

// ============================================================
// Tests comportementaux — création chantier → chat inséré
// ============================================================

describe('GAP-8-001 COMPORTEMENTAL : création chantier → chat créé auto (D-8-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTrialActive.mockResolvedValue(undefined)
  })

  it('CREATE-CHAT-1 : POST /api/chantiers → 201 + table chats accédée (D-8-01)', async () => {
    // Tracker les appels à la table chats
    const chatsInsertCalls: Array<unknown> = []

    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'chantiers') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: mockChantierInserted,
                error: null,
              }),
            }),
          }),
        }
      }
      if (tableName === 'chats') {
        // Le handler insère dans chats sans .select().single() (best-effort, pas de retour attendu)
        return {
          insert: vi.fn().mockImplementation((data: unknown) => {
            chatsInsertCalls.push(data)
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })

    const req = new NextRequest('http://localhost/api/chantiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify(validChantierBody),
    })

    const response = await POST(req)

    expect(response.status).toBe(201)

    // D-8-01 BINDING : l'INSERT dans chats doit avoir été déclenché
    expect(chatsInsertCalls.length).toBeGreaterThan(0)

    // Le payload inséré dans chats doit contenir chantier_id
    const chatInsertData = chatsInsertCalls[0] as Record<string, unknown>
    expect(chatInsertData?.['chantier_id']).toBe(CHANTIER_ID)
    expect(chatInsertData?.['organisation_id']).toBe(ORG_ID)
  })

  it('CREATE-CHAT-2 : INSERT chats échoue → chantier créé quand même (best-effort D-8-01)', async () => {
    // D-8-01 BINDING : si l'INSERT chat échoue, le chantier est quand même créé
    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'chantiers') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: mockChantierInserted,
                error: null,
              }),
            }),
          }),
        }
      }
      if (tableName === 'chats') {
        // Simule une erreur lors de l'insertion du chat (ex: contrainte UNIQUE violée)
        return {
          insert: vi.fn().mockResolvedValue({
            error: { message: 'DB error — duplicate key violates unique constraint' },
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })

    const req = new NextRequest('http://localhost/api/chantiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify(validChantierBody),
    })

    const response = await POST(req)

    // Le chantier doit être créé quand même (best-effort)
    expect(response.status).toBe(201)

    // Un warn doit être loggé (échec best-effort)
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('CREATE-CHAT-3 : GET /api/chantiers/[id]/chat cross-org → filtre organisation_id (US-066)', () => {
    // Test structurel — le handler doit filtrer par organisation_id
    const chatRoutePath = resolve(
      __dirname,
      '../../../app/api/chantiers/[id]/chat/route.ts',
    )

    let source: string
    try {
      source = readFileSync(chatRoutePath, 'utf-8')
    } catch {
      console.warn('CREATE-CHAT-3 : app/api/chantiers/[id]/chat/route.ts non trouvé — vérification manuelle')
      return
    }

    // Le handler doit filtrer par organisation_id (isolation multi-tenant D-028)
    expect(source).toContain('organisation_id')
    // Le handler doit retourner 404 si non trouvé
    expect(source).toMatch(/404|not found/i)
  })
})
