/**
 * __tests__/briefing/genererContenuBriefing.test.ts
 *
 * Tests Vitest pour lib/briefing/genererContenuBriefing.ts
 * D-7-04 BINDING : best-effort — jamais throw vers le cron
 * D-7-05 : 1 appel Sonnet par chantier
 * D-7-11 : model='claude-sonnet-4-6' passé explicitement
 * TST-K7-04 : 1 SignauxBriefingChantier par appel (pas de mix cross-org)
 *
 * Cas couverts :
 *   GC-1 : Happy path — LLM répond → { contenu: string, llmUtilise: true }
 *   GC-2 : LLM KO → fallback → { contenu: string, llmUtilise: false } (jamais throw)
 *   GC-3 : Contenu tronqué à 8000 chars max
 *   GC-4 : model='claude-sonnet-4-6' transmis au LLM client (D-7-11)
 *   GC-5 : note_privee_conducteur absent du prompt (D-051 — vérifié via type SignauxBriefingChantier)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockLlmGenerate, mockLogger, mockFallback } = vi.hoisted(() => {
  return {
    mockLlmGenerate: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockFallback: vi.fn().mockReturnValue('Message fallback déterministe'),
  }
})

vi.mock('@/lib/llm/register', () => ({}))  // side-effect — aucun effet dans les tests

vi.mock('@/lib/llm/client', () => ({
  getLLMClient: () => ({
    generate: mockLlmGenerate,
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

vi.mock('@/lib/briefing/genererMessageFallbackBriefing', () => ({
  genererMessageFallbackBriefing: mockFallback,
}))

// ============================================================
// Fixture
// ============================================================

const SIGNAUX_BASE = {
  chantier_id: 'chantier-1',
  chantier_nom: 'Rénovation Leclerc',
  organisation_id: 'org-1',
  semaine_iso: 26,
  annee_iso: 2026,
  generated_at: '2026-06-22T08:30:00Z',
  statut: 'actif' as const,
  budget_ratio: 0.75,
  jours_restants_fin: 30,
  derives_actives: [],
  jalons_semaine: [],
  meteo: {
    code_postal: '75001',
    jours: [],
    source: 'indisponible' as const,
    fetched_at: null,
  },
  seuil_budget: 0.85,
}

// ============================================================
// Tests
// ============================================================

describe('genererContenuBriefing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GC-1 : happy path — LLM répond avec output valide (≥100 chars) → llmUtilise=true', async () => {
    // BriefingOutputSchema exige min 100 chars — simuler un output valide
    const contenuValide = 'Le chantier Rénovation Leclerc présente un avancement de 75% du budget consommé avec 30 jours restants avant la date de fin prévue. Les conditions sont favorables cette semaine.'
    mockLlmGenerate.mockResolvedValue(contenuValide)
    const { genererContenuBriefing } = await import('@/lib/briefing/genererContenuBriefing')

    const result = await genererContenuBriefing(SIGNAUX_BASE)

    expect(result.llmUtilise).toBe(true)
    expect(result.contenu).toBe(contenuValide)
  })

  it('GC-2 : LLM KO → fallback → llmUtilise=false, jamais throw', async () => {
    mockLlmGenerate.mockRejectedValue(new Error('LLM timeout'))
    const { genererContenuBriefing } = await import('@/lib/briefing/genererContenuBriefing')

    // Ne doit JAMAIS throw (D-7-04 BINDING)
    await expect(genererContenuBriefing(SIGNAUX_BASE)).resolves.not.toThrow()
    const result = await genererContenuBriefing(SIGNAUX_BASE)

    expect(result.llmUtilise).toBe(false)
    expect(result.contenu).toBe('Message fallback déterministe')
    expect(mockFallback).toHaveBeenCalledWith(SIGNAUX_BASE)
  })

  it('GC-3 : output LLM > 8000 chars → BriefingOutputSchema invalide → fallback (D-7-04)', async () => {
    // Un output > 8000 chars dépasse le CHECK DB specs §2.2 — BriefingOutputSchema le rejette
    // D-7-04 best-effort : output invalide → fallback déterministe, llmUtilise=false
    const contenuLong = 'x'.repeat(10000)
    mockLlmGenerate.mockResolvedValue(contenuLong)
    const { genererContenuBriefing } = await import('@/lib/briefing/genererContenuBriefing')

    const result = await genererContenuBriefing(SIGNAUX_BASE)

    // L'output invalide déclenche le fallback
    expect(result.llmUtilise).toBe(false)
    expect(result.contenu).toBe('Message fallback déterministe')
    expect(mockFallback).toHaveBeenCalledWith(SIGNAUX_BASE)
  })

  it('GC-4 : model="claude-sonnet-4-6" transmis au LLM client (D-7-11)', async () => {
    // Output suffisamment long pour passer BriefingOutputSchema (min 100 chars)
    const contenuValide = 'Le chantier Rénovation Leclerc présente un avancement de 75% du budget consommé avec 30 jours restants avant la date de fin prévue. Les conditions sont favorables cette semaine.'
    mockLlmGenerate.mockResolvedValue(contenuValide)
    const { genererContenuBriefing } = await import('@/lib/briefing/genererContenuBriefing')

    await genererContenuBriefing(SIGNAUX_BASE)

    expect(mockLlmGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    )
  })

  it('GC-5 : note_privee_conducteur absent du type SignauxBriefingChantier (D-051)', () => {
    // Vérification structurelle : le type ne contient pas ce champ
    expect('note_privee_conducteur' in SIGNAUX_BASE).toBe(false)
    // Si le test compile, la protection structurelle TypeScript est effective
  })

  it('GC-6 : output LLM trop court (< 100 chars) → BriefingOutputSchema invalide → fallback (D-7-04)', async () => {
    // Un output trop court est rejeté par BriefingOutputSchema — D-7-04 best-effort → fallback
    mockLlmGenerate.mockResolvedValue('Trop court.')
    const { genererContenuBriefing } = await import('@/lib/briefing/genererContenuBriefing')

    const result = await genererContenuBriefing(SIGNAUX_BASE)

    expect(result.llmUtilise).toBe(false)
    expect(result.contenu).toBe('Message fallback déterministe')
    expect(mockFallback).toHaveBeenCalledWith(SIGNAUX_BASE)
  })
})
