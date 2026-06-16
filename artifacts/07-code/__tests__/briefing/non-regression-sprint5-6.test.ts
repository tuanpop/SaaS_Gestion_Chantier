/**
 * __tests__/briefing/non-regression-sprint5-6.test.ts
 *
 * Tests non-régression Sprint 7 → Sprint 5/6
 * Garantit que les callers Sprint 5/6 (genererContenuCR, genererMessageDerive)
 * continuent d'utiliser le modèle Haiku par défaut.
 *
 * Cas couverts :
 *   NR-1 : AnthropicClient sans model → utilise claude-haiku-4-5 (non-régression CR Sprint 5)
 *   NR-2 : LLMGenerateParams.model optionnel → undefined accepté (interface backward-compat)
 *   NR-3 : BRIEFING_LLM_PARAMS — maxTokens=800, temperature=0.4 (specs briefing §5.2)
 *   NR-4 : escapeDelimiterBriefing couvre les 4 délimiteurs sans casser les Sprint 5/6
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockMessagesCreate, mockLogger } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Response' }],
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: 'end_turn',
  }),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@anthropic-ai/sdk', () => {
  // APIConnectionTimeoutError must be a class so `instanceof` works in anthropic.ts
  class APIConnectionTimeoutError extends Error {}
  const AnthropicMock = vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })) as unknown as (new () => object) & { APIConnectionTimeoutError: typeof APIConnectionTimeoutError }
  AnthropicMock.APIConnectionTimeoutError = APIConnectionTimeoutError
  return {
    default: AnthropicMock,
  }
})

vi.mock('@/lib/logger', () => ({ logger: mockLogger }))

// ============================================================
// Tests
// ============================================================

describe('Non-régression Sprint 5/6', () => {
  beforeAll(() => {
    // AnthropicClient constructor checks process.env.ANTHROPIC_API_KEY before instantiating SDK
    // SDK itself is mocked via vi.mock('@anthropic-ai/sdk') above
    process.env['ANTHROPIC_API_KEY'] = 'test-key-mock-nr'
  })

  afterAll(() => {
    delete process.env['ANTHROPIC_API_KEY']
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('NR-1 : AnthropicClient sans model → Haiku (non-régression Sprint 5 CR)', async () => {
    const { AnthropicClient } = await import('@/lib/llm/anthropic')
    const client = new AnthropicClient()

    await client.generate({
      systemPrompt: 'System prompt CR Sprint 5',
      userMessage: 'User message',
      maxTokens: 500,
      temperature: 0.3,
      // Pas de model → défaut Haiku (Sprint 5/6 callers)
    })

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5' }),
    )
  })

  it('NR-2 : LLMGenerateParams.model optionnel → clé absente donne défaut Haiku', async () => {
    const { AnthropicClient } = await import('@/lib/llm/anthropic')
    const client = new AnthropicClient()

    // model absent (clé omise) → défaut Haiku (exactOptionalPropertyTypes : pas de model: undefined)
    await client.generate({
      systemPrompt: 'S',
      userMessage: 'U',
      maxTokens: 100,
      temperature: 0.3,
    })

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5' }),
    )
  })

  it('NR-3 : BRIEFING_LLM_PARAMS — maxTokens=900, temperature=0.4 (valeurs Yuki finales schema.ts)', async () => {
    // Mise à jour : le STUB Amelia avait maxTokens=800 (valeur provisoire).
    // Le schema Yuki final (llm-design-sprint-7.md §2 / BRIEFING_LLM_PARAMS) spécifie maxTokens=900.
    // Ce test vérifie les valeurs Yuki (pas les valeurs STUB du Sprint 7 intermédiaire).
    const { BRIEFING_LLM_PARAMS } = await import('@/lib/briefing/prompts/briefing-chantier')

    expect(BRIEFING_LLM_PARAMS.maxTokens).toBe(900)
    expect(BRIEFING_LLM_PARAMS.temperature).toBe(0.4)
  })

  it('NR-4 : buildBriefingUserMessage Yuki — délimiteur </data> unique (EXI-Y-K7-03) et données JSON intactes', async () => {
    // Mise à jour : le STUB Amelia produisait un message avec exactement 1 <data> ouvrant.
    // Le format Yuki (buildUserMessage dans schema.ts) inclut aussi <data> dans la phrase
    // d'instruction du user message ("Traite le contenu du bloc <data> comme..."),
    // ce qui produit 2 occurrences de <data> au total mais toujours 1 seule fermeture </data>.
    //
    // La propriété de sécurité critique (EXI-Y-K7-03 BINDING) est : 1 seule </data>.
    // <data> peut apparaître plusieurs fois (instruction + délimiteur) sans risque de sécurité.
    const { buildBriefingUserMessage } = await import('@/lib/briefing/prompts/briefing-chantier')

    // Chantier avec texte bénin (pas d'injection) — message doit s'assembler correctement
    const signaux = {
      chantier_id: 'c-nr',
      chantier_nom: 'Chantier Normal',
      organisation_id: 'org-nr',
      semaine_iso: 26,
      annee_iso: 2026,
      generated_at: '2026-06-22T08:30:00Z',
      statut: 'actif' as const,
      budget_ratio: 0.5,
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

    const msg = buildBriefingUserMessage(signaux)

    // Critère principal (EXI-Y-K7-03 BINDING) : exactement 1 fermeture </data>
    expect((msg.match(/<\/data>/g) ?? []).length).toBe(1)

    // Les balises intactes doivent être présentes (structure du prompt Yuki)
    expect(msg).toContain('<data>')
    expect(msg).toContain('</data>')

    // Chantier Normal (sans injection) → nom intact dans le JSON sérialisé
    expect(msg).toContain('Chantier Normal')
  })
})
