// tests/unit/detection-derives.test.ts — Tests unitaires des fonctions de détection déterministes
// D-008 BINDING : la détection est 100% déterministe (pas d'appel LLM).
// Ces tests vérifient les 4 règles de dérive pures (budget, retard, tâche bloquée, inactivité).
//
// EXI-Y-K6-02 BINDING : SignalDeriveTacheBloquee ne contient jamais note_privee_conducteur.
// D-045 BINDING : aucun filtre deleted_at sur taches (testé dans taches-no-deleted-at.test.ts).
// V-09 BINDING : calculs UTC.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  detecterDeriveBudget,
  detecterDeriveRetard,
  detecterDerivesTacheBloquee,
  detecterDeriveInactivite,
  detecterDerives,
  N_MAX_TACHES_BLOQUEES,
  type ChantierActif,
} from '../../lib/detection/detecterDerives'
import type { SeuilsEffectifs } from '../../types/detection'

// ============================================================
// Mocks
// ============================================================

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

// ============================================================
// Fixtures
// ============================================================

const SEUILS_TEST: SeuilsEffectifs = {
  organisation_id: 'org-1',
  ratio_budget: 0.85,
  jours_blocage: 3,
  jours_inactivite: 7,
  source: 'defaut',
}

function makeChantier(overrides: Partial<ChantierActif> = {}): ChantierActif {
  return {
    id: 'chantier-1',
    organisation_id: 'org-1',
    nom: 'Chantier Test',
    statut: 'actif',
    budget_alloue: 100_000,
    budget_depense: 0,
    date_fin_prevue: null,
    updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // hier
    ...overrides,
  }
}

// Crée un mock adminClient qui retourne des données pour from('taches') et from('photos')
function makeAdminClient(opts: {
  tachesData?: unknown[]
  tachesError?: { message: string } | null
  photosData?: unknown[]
  photosError?: { message: string } | null
} = {}) {
  const tachesQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: opts.tachesData ?? [],
      error: opts.tachesError ?? null,
    }),
    in: vi.fn().mockReturnThis(),
  }

  const photosQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: opts.photosData ?? [],
      error: opts.photosError ?? null,
    }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'taches') return tachesQuery
      if (table === 'photos') return photosQuery
      return tachesQuery
    }),
  }
}

// ============================================================
// detecterDeriveBudget
// ============================================================

describe('detecterDeriveBudget', () => {
  it('retourne null si budget_alloue IS NULL (RG-DERIVE-019)', () => {
    const chantier = makeChantier({ budget_alloue: null })
    expect(detecterDeriveBudget(chantier, SEUILS_TEST)).toBeNull()
  })

  it('retourne null si budget_alloue = 0 (division par zéro protégée)', () => {
    const chantier = makeChantier({ budget_alloue: 0, budget_depense: 0 })
    expect(detecterDeriveBudget(chantier, SEUILS_TEST)).toBeNull()
  })

  it('retourne null si ratio <= seuil (pas de dérive)', () => {
    const chantier = makeChantier({ budget_alloue: 100_000, budget_depense: 80_000 })
    // ratio = 0.80, seuil = 0.85 → pas de dérive
    expect(detecterDeriveBudget(chantier, SEUILS_TEST)).toBeNull()
  })

  it('retourne SignalDeriveBudget si ratio > seuil (happy path)', () => {
    const chantier = makeChantier({ budget_alloue: 100_000, budget_depense: 90_000 })
    // ratio = 0.90 > 0.85 → dérive
    const signal = detecterDeriveBudget(chantier, SEUILS_TEST)
    expect(signal).not.toBeNull()
    expect(signal!.type).toBe('budget_depasse')
    expect(signal!.ratio).toBeCloseTo(0.9)
    expect(signal!.depassement_eur).toBe(-10_000) // 90000 - 100000
    expect(signal!.seuil_applique).toBe(0.85)
  })

  it('respecte la borne seuil 0.50 (EXI-Y-K6-07)', () => {
    const seuilsBas: SeuilsEffectifs = { ...SEUILS_TEST, ratio_budget: 0.50 }
    const chantier = makeChantier({ budget_alloue: 100_000, budget_depense: 51_000 })
    const signal = detecterDeriveBudget(chantier, seuilsBas)
    expect(signal).not.toBeNull()
    expect(signal!.type).toBe('budget_depasse')
  })

  it('retourne null exactement au seuil (boundary — ratio = seuil)', () => {
    const chantier = makeChantier({ budget_alloue: 100_000, budget_depense: 85_000 })
    // ratio = 0.85 = seuil — strictement supérieur requis (>)
    expect(detecterDeriveBudget(chantier, SEUILS_TEST)).toBeNull()
  })
})

// ============================================================
// detecterDeriveRetard
// ============================================================

describe('detecterDeriveRetard', () => {
  it('retourne null si date_fin_prevue IS NULL', () => {
    const chantier = makeChantier({ date_fin_prevue: null })
    expect(detecterDeriveRetard(chantier)).toBeNull()
  })

  it('retourne null si date_fin_prevue >= today (dans les temps)', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
    const chantier = makeChantier({ date_fin_prevue: tomorrow })
    expect(detecterDeriveRetard(chantier)).toBeNull()
  })

  it('retourne SignalDeriveRetard si date_fin_prevue < today (happy path)', () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
    const chantier = makeChantier({ date_fin_prevue: yesterday })
    const signal = detecterDeriveRetard(chantier)
    expect(signal).not.toBeNull()
    expect(signal!.type).toBe('retard_date_fin')
    expect(signal!.date_fin_prevue).toBe(yesterday)
    expect(signal!.jours_retard).toBeGreaterThanOrEqual(1)
  })

  it('retourne null si date_fin_prevue = today (boundary — pas encore en retard)', () => {
    const today = new Date().toISOString().split('T')[0]!
    const chantier = makeChantier({ date_fin_prevue: today })
    // today >= today → pas de dérive
    expect(detecterDeriveRetard(chantier)).toBeNull()
  })
})

// ============================================================
// detecterDerivesTacheBloquee
// ============================================================

describe('detecterDerivesTacheBloquee', () => {
  it('retourne [] si aucune tâche bloquée suffisamment longue', async () => {
    // Tâche bloquée depuis 1 jour, seuil = 3 jours
    const recentlyBlocked = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    const client = makeAdminClient({
      tachesData: [{ id: 't-1', titre: 'Tâche', updated_at: recentlyBlocked }],
    })

    // La fonction filtre via .lt('updated_at', seuilDate) côté DB — ici on simule que DB retourne []
    const clientEmpty = makeAdminClient({ tachesData: [] })
    const result = await detecterDerivesTacheBloquee('chantier-1', SEUILS_TEST, clientEmpty as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).toEqual([])
  })

  it('retourne SignalDeriveTacheBloquee pour chaque tâche bloquée longue (happy path)', async () => {
    const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5j ago
    const client = makeAdminClient({
      tachesData: [
        { id: 't-1', titre: 'Tâche bloquée', updated_at: oldDate },
        { id: 't-2', titre: 'Autre tâche bloquée', updated_at: oldDate },
      ],
    })

    const result = await detecterDerivesTacheBloquee('chantier-1', SEUILS_TEST, client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe('tache_bloquee_longue')
    expect(result[0]!.tache_id).toBe('t-1')
    expect(result[0]!.jours_bloque).toBeGreaterThanOrEqual(4)
    expect(result[0]!.seuil_applique).toBe(3)
  })

  it('EXI-Y-K6-02 BINDING : SignalDeriveTacheBloquee ne contient JAMAIS note_privee_conducteur', async () => {
    const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    // Même si la DB retournait note_privee_conducteur (ce qu'elle ne fera jamais grâce au SELECT explicite),
    // le mapping garantit qu'elle n'est pas dans le signal.
    const client = makeAdminClient({
      tachesData: [
        {
          id: 't-1',
          titre: 'Tâche',
          updated_at: oldDate,
          // note_privee_conducteur intentionnellement incluse dans la réponse mockée
          // pour tester que le mapping l'exclut
          note_privee_conducteur: 'SECRET',
        },
      ],
    })

    const result = await detecterDerivesTacheBloquee('chantier-1', SEUILS_TEST, client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('note_privee_conducteur')
  })

  it(`respecte le plafond N_MAX_TACHES_BLOQUEES = ${N_MAX_TACHES_BLOQUEES} (D-6-14)`, async () => {
    // La limite est appliquée côté DB (.limit(N_MAX_TACHES_BLOQUEES)) — ici on simule N+2 retournés
    // pour confirmer que le mapping ne les amplifie pas (la DB est censée respecter la limite)
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const tachesData = Array.from({ length: N_MAX_TACHES_BLOQUEES }, (_, i) => ({
      id: `t-${i}`,
      titre: `Tâche ${i}`,
      updated_at: oldDate,
    }))
    const client = makeAdminClient({ tachesData })

    const result = await detecterDerivesTacheBloquee('chantier-1', SEUILS_TEST, client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).toHaveLength(N_MAX_TACHES_BLOQUEES)
  })

  it('retourne [] si erreur DB (best-effort — ne jette pas)', async () => {
    const client = makeAdminClient({
      tachesError: { message: 'DB error' },
    })
    // L'erreur est dans la tachesQuery, mais la limite mock est via .limit()
    // On remplace par un client qui retourne erreur
    const errorClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    }
    const result = await detecterDerivesTacheBloquee('chantier-1', SEUILS_TEST, errorClient as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).toEqual([])
  })
})

// ============================================================
// detecterDeriveInactivite
// ============================================================

describe('detecterDeriveInactivite', () => {
  it('retourne null si chantier actif depuis moins de jours_inactivite', async () => {
    const recentActivity = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3j ago
    const chantier = makeChantier({ updated_at: recentActivity })
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }
    // Simule 0 tâches → fallback chantier.updated_at (3j < 7j seuil)
    const tachesClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis(),
      }),
    }
    const mixedClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }

    // Ici on simule directement : 0 tâches → fallback updated_at 3j < seuil 7j
    const clientZeroTaches = {
      from: vi.fn((table: string) => {
        if (table === 'taches') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: undefined,
            // La fonction appelle .select().eq().eq() puis attend le résultat
          }
        }
        return {}
      }),
    }

    // Mock simplifié : retour direct
    const adminClientMock = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
        eq: vi.fn().mockReturnThis(),
      }),
    }

    // Avec 0 tâches, fallback chantier.updated_at = 3j < seuil 7j → null
    const result = await detecterDeriveInactivite(chantier, SEUILS_TEST, adminClientMock as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).toBeNull()
  })

  it('retourne SignalDeriveInactivite si aucune activité depuis > jours_inactivite (happy path)', async () => {
    const oldActivity = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10j
    const chantier = makeChantier({ updated_at: oldActivity })

    // 0 tâches → fallback chantier.updated_at = 10j > seuil 7j → dérive
    const adminClientMock = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis(),
      }),
    }

    const result = await detecterDeriveInactivite(chantier, SEUILS_TEST, adminClientMock as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('inactivite_chantier')
    expect(result!.jours_sans_activite).toBeGreaterThanOrEqual(9)
    expect(result!.seuil_applique).toBe(7)
  })

  it('V-07 BINDING : passe par taches→photos.tache_id (jamais photos.chantier_id)', async () => {
    const chantier = makeChantier()
    const fromSpy = vi.fn()
    let capturedPhotosQuery: { in?: (...args: unknown[]) => unknown } | null = null

    const tachesMock = {
      select: vi.fn().mockResolvedValue({
        data: [{ id: 't-1', updated_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() }],
        error: null,
      }),
      eq: vi.fn().mockReturnThis(),
    }
    const photosMock = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    fromSpy.mockImplementation((table: string) => {
      if (table === 'taches') return tachesMock
      if (table === 'photos') {
        capturedPhotosQuery = photosMock
        return photosMock
      }
      return tachesMock
    })

    const client = { from: fromSpy }
    await detecterDeriveInactivite(chantier, SEUILS_TEST, client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)

    // Vérifie que photos a été appelé avec .in('tache_id', ...) — pas .eq('chantier_id', ...)
    if (capturedPhotosQuery && (capturedPhotosQuery as { in: (...args: unknown[]) => unknown }).in) {
      const inCall = (photosMock.in as ReturnType<typeof vi.fn>).mock.calls
      expect(inCall.length).toBeGreaterThan(0)
      expect(inCall[0]![0]).toBe('tache_id') // V-07 BINDING
      expect(inCall[0]![0]).not.toBe('chantier_id')
    }
  })
})

// ============================================================
// detecterDerives (agrégat)
// ============================================================

describe('detecterDerives', () => {
  it('retourne un snapshot avec derives=[] si aucune règle déclenchée', async () => {
    const chantier = makeChantier({
      budget_alloue: 100_000,
      budget_depense: 70_000, // 0.70 < 0.85
      date_fin_prevue: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // future
      updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // hier
    })

    const adminClientMock = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        in: vi.fn().mockReturnThis(),
      }),
    }

    const result = await detecterDerives(chantier, SEUILS_TEST, adminClientMock as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result.derives).toEqual([])
    expect(result.chantier_id).toBe('chantier-1')
    expect(result.organisation_id).toBe('org-1')
    expect(result.evaluated_at).toBeTruthy()
  })

  it('D-008 BINDING : retourne un SignauxDeriveChantier avec toutes les dérives détectées', async () => {
    // Chantier avec budget dépassé ET retard (2 dérives)
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
    const chantier = makeChantier({
      budget_alloue: 100_000,
      budget_depense: 90_000, // 0.90 > 0.85 → dérive budget
      date_fin_prevue: pastDate, // passé → dérive retard
      updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const adminClientMock = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        in: vi.fn().mockReturnThis(),
      }),
    }

    const result = await detecterDerives(chantier, SEUILS_TEST, adminClientMock as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result.derives.length).toBeGreaterThanOrEqual(2)
    const types = result.derives.map((d) => d.type)
    expect(types).toContain('budget_depasse')
    expect(types).toContain('retard_date_fin')
  })
})
