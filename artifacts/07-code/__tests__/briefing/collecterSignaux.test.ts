/**
 * __tests__/briefing/collecterSignaux.test.ts
 *
 * Tests Vitest pour lib/briefing/collecterSignaux.ts
 * GAP-008 : US-063 / RG-BRIEFING-005 / D-008 BINDING
 *
 * D-008 BINDING : collecterSignaux est une fonction TS PURE sans appel LLM.
 * D-051 BINDING : note_privee_conducteur jamais sélectionné.
 * D-045 BINDING : pas de filtre deleted_at sur taches (hard delete).
 * RG-BRIEFING-005 : collecte déterministe des 4 sources.
 *
 * Cas couverts :
 *   CS-1 : 0 appel getLLMClient (D-008 BINDING)
 *   CS-2 : 2 dérives actives → derives_actives.length === 2
 *   CS-3 : tâche hors fenêtre 7j → non incluse dans jalons_semaine
 *   CS-4 : tâche dans fenêtre 7j → incluse avec jours_restants correct
 *   CS-5 : budget_alloue = null → budget_ratio = null (pas de crash)
 *   CS-6 : budget_alloue = 0 → budget_ratio = null (division par zéro protégée)
 *   CS-7 : note_privee_conducteur absent du SELECT SQL taches (D-051)
 *   CS-8 : requête taches sans appel de méthode filtre deleted_at (D-045)
 *   CS-9 : meteo injectée propagée dans SignauxBriefingChantier (D-7-02)
 *   CS-10 : date_fin_prevue non null → jours_restants_fin calculé
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockLogger, mockGetLLMClient } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockGetLLMClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: mockLogger }))

// Vérification que getLLMClient n'est pas importé par collecterSignaux (D-008 BINDING)
vi.mock('@/lib/llm/client', () => ({ getLLMClient: mockGetLLMClient }))

// ============================================================
// Fixtures
// ============================================================

const CHANTIER_ID = 'chantier-uuid-test-001'
const ORG_ID = 'org-uuid-test-001'
const ANNEE_ISO = 2026
const SEMAINE_ISO = 26

const METEO_INDISPONIBLE = {
  code_postal: '75001',
  jours: [],
  source: 'indisponible' as const,
  fetched_at: null,
}

/** Créer un mock adminClient Supabase chainable */
function buildAdminMock(overrides: {
  chantierData?: Record<string, unknown> | null
  chantierError?: { message: string } | null
  derivesData?: unknown[] | null
  derivesError?: { message: string } | null
  tachesData?: unknown[] | null
  tachesError?: { message: string } | null
  seuilsData?: Record<string, unknown> | null
}) {
  const {
    chantierData = {
      id: CHANTIER_ID,
      organisation_id: ORG_ID,
      nom: 'Chantier Test',
      statut: 'actif',
      budget_alloue: 10000,
      budget_depense: 5000,
      date_fin_prevue: null,
      code_postal: '75001',
    },
    chantierError = null,
    derivesData = [],
    derivesError = null,
    tachesData = [],
    tachesError = null,
    seuilsData = null,
  } = overrides

  // Supabase chainable mock
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    const makeChain = (resolvedData: unknown, resolvedError: unknown) => {
      const chain: Record<string, unknown> = {}
      const methods = ['select', 'eq', 'neq', 'is', 'in', 'lt', 'gte', 'lte', 'not', 'order', 'limit']
      for (const m of methods) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      chain['single'] = vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError })
      chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError })
      chain['then'] = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: resolvedData, error: resolvedError }).then(resolve)
      chain['catch'] = (reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: resolvedData, error: resolvedError }).catch(reject)
      return chain
    }

    if (table === 'chantiers') return makeChain(chantierData, chantierError)
    if (table === 'derives_detectees') return makeChain(derivesData, derivesError)
    if (table === 'taches') return makeChain(tachesData, tachesError)
    if (table === 'seuils_derives') return makeChain(seuilsData, null)
    if (table === 'users') return makeChain([], null)
    return makeChain(null, null)
  })

  return { from: mockFrom }
}

// ============================================================
// Tests
// ============================================================

describe('collecterSignaux (D-008 BINDING / US-063 / RG-BRIEFING-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('CS-1 : 0 appel getLLMClient (D-008 BINDING — collecte 100% déterministe)', async () => {
    const adminClient = buildAdminMock({})
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      METEO_INDISPONIBLE,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    // D-008 BINDING : aucun appel LLM pendant la collecte
    expect(mockGetLLMClient).not.toHaveBeenCalled()
  })

  it('CS-2 : 2 dérives actives (resolved_at IS NULL) → derives_actives.length === 2', async () => {
    const adminClient = buildAdminMock({
      derivesData: [
        {
          id: 'derive-1',
          type: 'budget_depasse',
          signal_valeur: 92,
          signal_unite: '%',
          message_llm: 'Budget à 92%',
          detected_at: '2026-06-14T08:00:00Z',
        },
        {
          id: 'derive-2',
          type: 'tache_bloquee_longue',
          signal_valeur: 5,
          signal_unite: 'jours',
          message_llm: null,
          detected_at: '2026-06-13T08:00:00Z',
        },
      ],
    })
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    const signaux = await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      METEO_INDISPONIBLE,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    expect(signaux.derives_actives).toHaveLength(2)
    expect(signaux.derives_actives[0]!.type).toBe('budget_depasse')
    expect(signaux.derives_actives[1]!.type).toBe('tache_bloquee_longue')
  })

  it('CS-3 : tâche hors fenêtre 7j → non incluse dans jalons_semaine (fenêtre appliquée DB)', async () => {
    // Le filtre gte/lte est appliqué par Supabase (côté DB).
    // Le mock simule ce que la requête filtrée aurait retourné.
    const today = new Date()
    const todayPlus3 = new Date(today)
    todayPlus3.setUTCDate(today.getUTCDate() + 3)
    const dateEcheanceDansLaFenetre = todayPlus3.toISOString().split('T')[0]!

    const adminClient = buildAdminMock({
      tachesData: [
        {
          id: 'tache-1',
          titre: 'Pose carrelage',
          date_echeance: dateEcheanceDansLaFenetre,
          statut: 'en_cours',
          assigned_to: null,
          assigned_user: null,
        },
        // La tâche hors fenêtre n'est pas dans tachesData — le mock simule la requête DB filtrée
      ],
    })
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    const signaux = await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      METEO_INDISPONIBLE,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    expect(signaux.jalons_semaine).toHaveLength(1)
    expect(signaux.jalons_semaine[0]!.tache_titre).toBe('Pose carrelage')
    expect(signaux.jalons_semaine[0]!.date_echeance).toBe(dateEcheanceDansLaFenetre)
  })

  it('CS-4 : tâche dans fenêtre → jours_restants >= 0 et assigned_to_nom mappé', async () => {
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const dateEcheance = tomorrow.toISOString().split('T')[0]!

    const adminClient = buildAdminMock({
      tachesData: [{
        id: 'tache-demain',
        titre: 'Enduit façade',
        date_echeance: dateEcheance,
        statut: 'a_faire',
        assigned_to: 'user-123',
        assigned_user: { nom: 'Dupont', prenom: 'Jean' },
      }],
    })
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    const signaux = await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      METEO_INDISPONIBLE,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    expect(signaux.jalons_semaine).toHaveLength(1)
    const jalon = signaux.jalons_semaine[0]!
    expect(jalon.jours_restants).toBeGreaterThanOrEqual(0)
    expect(jalon.assigned_to_nom).toBe('Jean Dupont')
    // D-051 : note_privee_conducteur absent du type JalonSemaine
    expect('note_privee_conducteur' in jalon).toBe(false)
  })

  it('CS-5 : budget_alloue = null → budget_ratio = null (pas de crash)', async () => {
    const adminClient = buildAdminMock({
      chantierData: {
        id: CHANTIER_ID,
        organisation_id: ORG_ID,
        nom: 'Chantier Sans Budget',
        statut: 'actif',
        budget_alloue: null,
        budget_depense: 5000,
        date_fin_prevue: null,
        code_postal: '75001',
      },
    })
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    const signaux = await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      METEO_INDISPONIBLE,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    expect(signaux.budget_ratio).toBeNull()
  })

  it('CS-6 : budget_alloue = 0 → budget_ratio = null (division par zéro protégée)', async () => {
    const adminClient = buildAdminMock({
      chantierData: {
        id: CHANTIER_ID,
        organisation_id: ORG_ID,
        nom: 'Chantier Budget Zéro',
        statut: 'actif',
        budget_alloue: 0,
        budget_depense: 100,
        date_fin_prevue: null,
        code_postal: '75001',
      },
    })
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    const signaux = await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      METEO_INDISPONIBLE,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    expect(signaux.budget_ratio).toBeNull()
    expect(Number.isNaN(signaux.budget_ratio as unknown as number)).toBe(false)
  })

  it('CS-7 : note_privee_conducteur absent du SELECT SQL taches (D-051 BINDING)', () => {
    // Vérifie que la chaîne SELECT passée à .select() pour la table taches
    // ne contient pas "note_privee_conducteur".
    // Le fichier contient ce terme dans les commentaires AUDIT (intentionnel),
    // mais PAS dans les chaînes SQL opérationnelles.
    const srcPath = path.resolve(__dirname, '../../lib/briefing/collecterSignaux.ts')
    const src = fs.readFileSync(srcPath, 'utf-8')

    // Extraire les chaînes de sélection SQL (entre backticks après .select(`)
    // La protection est : note_privee_conducteur n'apparaît JAMAIS dans une backtick string de select
    // On vérifie que le SELECT explicite de taches liste les colonnes sans note_privee_conducteur
    const selectTachesMatch = src.match(/\.from\('taches'\)[\s\S]*?\.select\(`([\s\S]*?)`\)/)
    if (selectTachesMatch) {
      const selectString = selectTachesMatch[1]!
      expect(selectString).not.toContain('note_privee_conducteur')
      // Vérification positive : colonnes attendues présentes
      expect(selectString).toContain('titre')
      expect(selectString).toContain('date_echeance')
    } else {
      // Si le SELECT n'est pas dans ce format exact, vérifier via l'interface TacheRow
      // TacheRow dans le source ne doit pas avoir note_privee_conducteur
      const tacheRowMatch = src.match(/interface TacheRow \{([\s\S]*?)\}/)
      expect(tacheRowMatch).not.toBeNull()
      if (tacheRowMatch) {
        expect(tacheRowMatch[1]).not.toContain('note_privee_conducteur')
        expect(tacheRowMatch[1]).toContain('titre')
      }
    }
  })

  it('CS-8 : requête taches sans appel de méthode filtre deleted_at (D-045 BINDING — hard delete)', () => {
    // D-045 : taches n'a pas de colonne deleted_at — la requête ne doit jamais appeler
    // .is('deleted_at', ...) ou .eq('deleted_at', ...) dans le contexte taches.
    // Le fichier contient "deleted_at" dans les commentaires (intentionnel — documentation du BINDING),
    // mais PAS dans les appels de méthodes Supabase opérationnels.
    const srcPath = path.resolve(__dirname, '../../lib/briefing/collecterSignaux.ts')
    const src = fs.readFileSync(srcPath, 'utf-8')

    // Vérifier que ".is('deleted_at'" ou ".eq('deleted_at'" n'apparaît pas
    // (ce serait un filtre opérationnel sur une colonne inexistante)
    expect(src).not.toMatch(/\.is\(['"]deleted_at['"]/i)
    expect(src).not.toMatch(/\.eq\(['"]deleted_at['"]/i)
    expect(src).not.toMatch(/\.neq\(['"]deleted_at['"]/i)
    expect(src).not.toMatch(/\.not\(.*deleted_at/i)

    // Vérification positive : les filtres jalons sont présents (gte/lte sur date_echeance)
    expect(src).toContain('date_echeance')
    expect(src).toContain('.gte(')
    expect(src).toContain('.lte(')
  })

  it('CS-9 : meteo injectée (D-7-02) propagée dans SignauxBriefingChantier.meteo', async () => {
    const meteoApi = {
      code_postal: '69001',
      jours: [{
        date_iso: '2026-06-22',
        jour_semaine: 'Lundi',
        temp_min_c: 15,
        temp_max_c: 25,
        description: 'Ensoleillé',
        precipitation_mm: 0,
        vent_kmh: 15,
        alerte_pluie: false,
        alerte_gel: false,
        alerte_canicule: false,
        alerte_vent: false,
      }],
      source: 'api' as const,
      fetched_at: '2026-06-22T08:30:00Z',
    }

    const adminClient = buildAdminMock({
      chantierData: {
        id: CHANTIER_ID,
        organisation_id: ORG_ID,
        nom: 'Chantier Lyon',
        statut: 'actif',
        budget_alloue: 10000,
        budget_depense: 5000,
        date_fin_prevue: null,
        code_postal: '69001',
      },
    })
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    const signaux = await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      meteoApi,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    // La météo injectée doit être propagée telle quelle (D-7-02)
    expect(signaux.meteo.source).toBe('api')
    expect(signaux.meteo.code_postal).toBe('69001')
    expect(signaux.meteo.jours).toHaveLength(1)
  })

  it('CS-10 : date_fin_prevue non null → jours_restants_fin calculé (> 0 pour date future)', async () => {
    const futurDate = new Date()
    futurDate.setUTCDate(futurDate.getUTCDate() + 30)
    const dateFin = futurDate.toISOString().split('T')[0]!

    const adminClient = buildAdminMock({
      chantierData: {
        id: CHANTIER_ID,
        organisation_id: ORG_ID,
        nom: 'Chantier Avec Date Fin',
        statut: 'actif',
        budget_alloue: 10000,
        budget_depense: 5000,
        date_fin_prevue: dateFin,
        code_postal: '75001',
      },
    })
    const { collecterSignaux } = await import('@/lib/briefing/collecterSignaux')

    const signaux = await collecterSignaux(
      adminClient as unknown as ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>,
      CHANTIER_ID,
      METEO_INDISPONIBLE,
      ANNEE_ISO,
      SEMAINE_ISO,
    )

    expect(signaux.jours_restants_fin).not.toBeNull()
    expect(typeof signaux.jours_restants_fin).toBe('number')
    expect(signaux.jours_restants_fin).toBeGreaterThan(0)
  })
})
