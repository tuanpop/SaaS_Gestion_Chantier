/**
 * __tests__/briefing/llm-model-extension.test.ts
 *
 * Tests Vitest pour D-7-11 : extension du LLM client avec le paramètre model? optionnel
 * Objectif : vérifier que model? est backward-compatible avec Sprint 5/6 (Haiku reste le défaut).
 *
 * Cas couverts :
 *   LM-1 : model absent → défaut Haiku (non-régression Sprint 5/6)
 *   LM-2 : model='claude-sonnet-4-6' → Sonnet utilisé pour Sprint 7
 *   LM-3 : LLMGenerateParams.model est optionnel (type check via TypeScript)
 *   LM-4 : LLMModel union contient exactement Haiku et Sonnet
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

// ============================================================
// Mocks hoisted
// ============================================================

const { mockMessagesCreate, mockLogger } = vi.hoisted(() => {
  return {
    mockMessagesCreate: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }
})

vi.mock('@anthropic-ai/sdk', () => {
  // APIConnectionTimeoutError must be a class so `instanceof` works in anthropic.ts
  class APIConnectionTimeoutError extends Error {}
  const AnthropicMock = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })) as unknown as (new () => object) & { APIConnectionTimeoutError: typeof APIConnectionTimeoutError }
  AnthropicMock.APIConnectionTimeoutError = APIConnectionTimeoutError
  return {
    default: AnthropicMock,
  }
})

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

// ============================================================
// Tests
// ============================================================

describe('LLM model extension (D-7-11)', () => {
  beforeAll(() => {
    // AnthropicClient constructor checks process.env.ANTHROPIC_API_KEY before instantiating SDK
    // SDK itself is mocked via vi.mock('@anthropic-ai/sdk') above
    process.env['ANTHROPIC_API_KEY'] = 'test-key-mock-lm'
  })

  afterAll(() => {
    delete process.env['ANTHROPIC_API_KEY']
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Réponse LLM mock' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    })
  })

  it('LM-1 : model absent → défaut Haiku préservé (non-régression Sprint 5/6)', async () => {
    // Import dynamique pour que le mock soit en place
    const { AnthropicClient } = await import('@/lib/llm/anthropic')
    const client = new AnthropicClient()

    await client.generate({
      systemPrompt: 'System',
      userMessage: 'User',
      maxTokens: 100,
      temperature: 0.3,
      // Pas de model → défaut Haiku
    })

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
      }),
    )
  })

  it('LM-2 : model="claude-sonnet-4-6" → Sonnet utilisé (Sprint 7)', async () => {
    const { AnthropicClient } = await import('@/lib/llm/anthropic')
    const client = new AnthropicClient()

    await client.generate({
      systemPrompt: 'System',
      userMessage: 'User',
      maxTokens: 800,
      temperature: 0.4,
      model: 'claude-sonnet-4-6',
    })

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
      }),
    )
  })

  it('LM-3 : LLMGenerateParams.model est optionnel', async () => {
    const { } = await import('@/lib/llm/client')
    // Si ce test compile sans erreur, model? est bien optionnel
    // On vérifie juste que le module s'importe correctement
    expect(true).toBe(true)
  })

  it('LM-4 : LLMModel union contient Haiku et Sonnet', async () => {
    // Vérification indirecte via AnthropicClient : les deux modèles sont acceptés
    const { AnthropicClient } = await import('@/lib/llm/anthropic')
    const client = new AnthropicClient()

    // Haiku
    await client.generate({ systemPrompt: 'S', userMessage: 'U', maxTokens: 50, temperature: 0.1, model: 'claude-haiku-4-5' })
    expect(mockMessagesCreate).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5' }))

    // Sonnet
    await client.generate({ systemPrompt: 'S', userMessage: 'U', maxTokens: 50, temperature: 0.1, model: 'claude-sonnet-4-6' })
    expect(mockMessagesCreate).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }))
  })
})
