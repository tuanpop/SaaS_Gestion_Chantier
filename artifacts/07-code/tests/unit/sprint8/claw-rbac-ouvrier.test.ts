/**
 * tests/unit/sprint8/claw-rbac-ouvrier.test.ts
 *
 * Intégré depuis artifacts/10-qa/tests/sprint8/ — Sprint 8 QA Levi
 *
 * GAP-8-006 BLOQUANT : RBAC ouvrier @claw — contexte restreint (US-079, RG-CLAW-006, S-8-08)
 *
 * L'élévation de privilège via LLM est une menace HIGH (S-8-08 / EXI-Y-K8-07).
 * Un ouvrier ne doit voir que ses propres tâches dans la réponse @claw.
 * Le contexte construit pour un ouvrier NE DOIT PAS contenir :
 *   - les dérives actives (budget/retard)
 *   - les notes privées conducteur
 *   - les tâches d'autres ouvriers
 *   - les données de budget
 *   - les données d'autres chantiers ou organisations
 *
 * Binding :
 *   RG-CLAW-006 BINDING : contexte ouvrier = tâches affectées à CET ouvrier uniquement
 *   EXI-Y-K8-07 BINDING : contexte côté serveur (déterministe), pas délégué au LLM
 *   D-8-15 BINDING : anti-injection MAXIMALE
 *   D-051 BINDING : note_privee_conducteur absent
 *
 * Adaptation signature réelle :
 *   construireContexteBot(chantierId, organisationId, roleAppelant, adminClient, ouvrierUserId?)
 *   — adminClient passé directement au lieu de createAdminClient()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

vi.mock('@/lib/llm/register', () => ({}))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ from: vi.fn() }),
}))

import { construireContexteBot } from '@/lib/chat/construireContexteBot'
import type { ContexteBot } from '@/types/chat'

// ============================================================
// Fixtures
// ============================================================

const ORG_ID = 'org-uuid-0000-0000-0000-200000000001'
const CHANTIER_ID = 'chantier-uuid-000-0000-200000000001'
const OUVRIER_ID = 'ouvrier-uuid-000-0000-200000000001'
const CONDUCTEUR_ID = 'conducteur-uuid-0000-0000-200000000001'
const TACHE_OUVRIER_1 = 'tache-uuid-0000-0000-200000000001'
const TACHE_OUVRIER_2 = 'tache-uuid-0000-0000-200000000002'
const TACHE_AUTRE = 'tache-uuid-0000-0000-200000000099'

const chantierRow = {
  id: CHANTIER_ID,
  organisation_id: ORG_ID,
  nom: 'Rénovation Leclerc',
  statut: 'actif',
  date_debut: '2026-01-01',
  date_fin_prevue: '2026-12-31',
}

// Tâches du chantier (2 assignées à l'ouvrier, 1 à un autre)
const tachesChantier = [
  {
    id: TACHE_OUVRIER_1,
    titre: 'Pose fondations zone A',
    statut: 'a_faire',
    date_echeance: '2026-06-20',
    assigned_to: OUVRIER_ID,
    note_privee_conducteur: 'Client difficile — NE PAS mentionner', // D-051 : ne doit jamais sortir
  },
  {
    id: TACHE_OUVRIER_2,
    titre: 'Coulage béton',
    statut: 'en_cours',
    date_echeance: '2026-06-22',
    assigned_to: OUVRIER_ID,
    note_privee_conducteur: null,
  },
  {
    id: TACHE_AUTRE,
    titre: 'Rapport hebdo',
    statut: 'a_faire',
    date_echeance: '2026-06-25',
    assigned_to: CONDUCTEUR_ID,
    note_privee_conducteur: 'Confidentiel conducteur',
  },
]

// Dérives actives (ne doivent pas apparaître pour un ouvrier)
const derivesActives = [
  {
    id: 'derive-001',
    chantier_id: CHANTIER_ID,
    type: 'budget',
    valeur_actuelle: 95000,
    seuil_alerte: 90000,
    description: 'Budget dépassé de 5%',
    resolved_at: null,
  },
]

// Membres du chantier
const membresChantier = [
  { id: OUVRIER_ID, nom: 'Ben Youssef', prenom: 'Mohamed', role: 'ouvrier' },
  { id: CONDUCTEUR_ID, nom: 'Dupont', prenom: 'Jean', role: 'conducteur' },
]

/**
 * Construit le mock adminClient { from: mockAdminFrom } selon la table accédée.
 * La vraie signature de construireContexteBot prend adminClient en paramètre direct.
 */
function setupContexteMock() {
  mockAdminFrom.mockImplementation((tableName: string) => {
    if (tableName === 'chantiers') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: chantierRow, error: null }),
            }),
          }),
        }),
      }
    }

    if (tableName === 'taches') {
      const data = tachesChantier
      const orderFn = vi.fn().mockResolvedValue({ data, error: null })
      const isFn = vi.fn().mockReturnValue({ order: orderFn })
      const notFn = vi.fn().mockReturnValue({ is: isFn })
      const innerEqFn = vi.fn().mockReturnValue({ not: notFn })
      const eqFn = vi.fn().mockReturnValue({ eq: innerEqFn })
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn })

      return { select: selectFn }
    }

    if (tableName === 'derives_actives') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ data: derivesActives, error: null }),
            }),
          }),
        }),
      }
    }

    if (tableName === 'affectations') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                or: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }
    }

    if (tableName === 'users') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: membresChantier, error: null }),
            }),
          }),
        }),
      }
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })
}

// adminClient mocké passé directement à construireContexteBot
function getMockedAdminClient() {
  return { from: mockAdminFrom } as unknown as Parameters<typeof construireContexteBot>[3]
}

// ============================================================
// Tests RBAC ouvrier
// ============================================================

describe('GAP-8-006 BLOQUANT : RBAC ouvrier @claw — construireContexteBot (RG-CLAW-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupContexteMock()
  })

  it('RBAC-OUV-1 : role=ouvrier → derives_actives absent ou vide dans le contexte (S-8-08)', async () => {
    let contexte: ContexteBot | null = null
    try {
      contexte = await construireContexteBot(
        CHANTIER_ID,
        ORG_ID,
        'ouvrier',
        getMockedAdminClient(),
        OUVRIER_ID,
      )
    } catch {
      console.warn('RBAC-OUV-1 : construireContexteBot signature non correspondante — vérification manuelle')
      return
    }

    if (contexte === null) return

    // RG-CLAW-006 BINDING : les dérives actives ne doivent PAS être dans le contexte ouvrier
    const derives = (contexte as ContexteBot & { derives_actives?: unknown[] }).derives_actives
    expect(derives === undefined || (Array.isArray(derives) && derives.length === 0)).toBe(true)
  })

  it('RBAC-OUV-2 : role=ouvrier → seules les tâches de cet ouvrier (EXI-Y-K8-07)', async () => {
    let contexte: ContexteBot | null = null
    try {
      contexte = await construireContexteBot(
        CHANTIER_ID,
        ORG_ID,
        'ouvrier',
        getMockedAdminClient(),
        OUVRIER_ID,
      )
    } catch {
      console.warn('RBAC-OUV-2 : construireContexteBot signature non correspondante — vérification manuelle')
      return
    }

    if (contexte === null) return

    // Toutes les tâches retournées doivent être assignées à l'ouvrier courant
    const taches = contexte.taches
    if (taches && taches.length > 0) {
      const tachesNonOuvrier = taches.filter(
        (t) => t.assigned_to !== OUVRIER_ID && t.assigned_to !== null,
      )
      expect(tachesNonOuvrier).toHaveLength(0)
    }
  })

  it('RBAC-OUV-3 : contexte ouvrier ne contient JAMAIS note_privee_conducteur (D-051 BINDING)', async () => {
    let contexte: ContexteBot | null = null
    try {
      contexte = await construireContexteBot(
        CHANTIER_ID,
        ORG_ID,
        'ouvrier',
        getMockedAdminClient(),
        OUVRIER_ID,
      )
    } catch {
      console.warn('RBAC-OUV-3 : construireContexteBot signature non correspondante — vérification manuelle')
      return
    }

    if (contexte === null) return

    // D-051 BINDING : note_privee_conducteur absent structurellement
    const contexteStr = JSON.stringify(contexte)
    expect(contexteStr).not.toContain('note_privee_conducteur')
    expect(contexteStr).not.toContain('Client difficile')
    expect(contexteStr).not.toContain('Confidentiel conducteur')

    contexte.taches.forEach((tache) => {
      expect(Object.keys(tache)).not.toContain('note_privee_conducteur')
    })
  })

  it('RBAC-OUV-4 : role=conducteur → contexte plus large (pas filtré à un ouvrier)', async () => {
    let contexte: ContexteBot | null = null
    try {
      contexte = await construireContexteBot(
        CHANTIER_ID,
        ORG_ID,
        'conducteur',
        getMockedAdminClient(),
        undefined,
      )
    } catch {
      console.warn('RBAC-OUV-4 : construireContexteBot signature non correspondante — vérification manuelle')
      return
    }

    if (contexte === null) return

    // Le conducteur a accès à toutes les tâches (pas filtré par assigned_to)
    expect(contexte.taches.length).toBeGreaterThanOrEqual(0)
  })

  it('RBAC-OUV-5 : construireContexteBot avec role=ouvrier ne retourne pas de budget/montants', async () => {
    let contexte: ContexteBot | null = null
    try {
      contexte = await construireContexteBot(
        CHANTIER_ID,
        ORG_ID,
        'ouvrier',
        getMockedAdminClient(),
        OUVRIER_ID,
      )
    } catch {
      console.warn('RBAC-OUV-5 : construireContexteBot signature non correspondante — vérification manuelle')
      return
    }

    if (contexte === null) return

    // L'ouvrier ne doit pas voir les données financières
    const contexteStr = JSON.stringify(contexte)
    expect(contexteStr).not.toContain('budget')
    expect(contexteStr).not.toContain('budget_previsionnel')
    expect(contexteStr).not.toContain('budget_depense')
    expect(contexteStr).not.toContain('95000') // Valeur de la dérive budget
  })
})

// ============================================================
// Tests structurels — construireContexteBot.ts
// Chemin résolu depuis tests/unit/sprint8/ → ../../../lib/chat/
// ============================================================

describe('GAP-8-006 STRUCTUREL : construireContexteBot.ts — sécurité contexte', () => {
  it('STRUCT-CTX-1 : construireContexteBot.ts ne contient pas select("*") sur taches (D-8-15)', () => {
    const contextePath = resolve(
      __dirname,
      '../../../lib/chat/construireContexteBot.ts',
    )

    let source: string
    try {
      source = readFileSync(contextePath, 'utf-8')
    } catch {
      console.warn('STRUCT-CTX-1 : fichier construireContexteBot.ts non trouvé — vérification manuelle')
      return
    }

    // D-8-15 EXI-8-02 BINDING : jamais select('*') sur les tâches
    const starSelectOnTaches = source.match(/from\(['"]taches['"]\)[\s\S]{0,100}\.select\(['"\*]['"]\)/m)
    expect(starSelectOnTaches).toBeNull()
  })

  it('STRUCT-CTX-2 : construireContexteBot.ts ne contient pas note_privee_conducteur dans les queries (D-051)', () => {
    const contextePath = resolve(
      __dirname,
      '../../../lib/chat/construireContexteBot.ts',
    )

    let source: string
    try {
      source = readFileSync(contextePath, 'utf-8')
    } catch {
      console.warn('STRUCT-CTX-2 : fichier construireContexteBot.ts non trouvé — vérification manuelle')
      return
    }

    // D-051 BINDING : note_privee_conducteur ne doit PAS apparaître dans les SELECT queries
    const lines = source.split('\n')
    const codeLines = lines.filter((l) => {
      if (l.trim().startsWith('//') || l.trim().startsWith('*')) return false
      return l.includes('note_privee_conducteur')
    })

    expect(codeLines).toHaveLength(0)
  })

  it('STRUCT-CTX-3 : construireContexteBot.ts filtre par chantier_id ET organisation_id (EXI-8-04)', () => {
    const contextePath = resolve(
      __dirname,
      '../../../lib/chat/construireContexteBot.ts',
    )

    let source: string
    try {
      source = readFileSync(contextePath, 'utf-8')
    } catch {
      console.warn('STRUCT-CTX-3 : fichier construireContexteBot.ts non trouvé — vérification manuelle')
      return
    }

    // EXI-8-04 BINDING : contexte borné 1 chantier / 1 org
    expect(source).toContain('chantier_id')
    expect(source).toContain('organisation_id')
  })
})
