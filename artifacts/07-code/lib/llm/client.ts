// lib/llm/client.ts — Interface ILLMClient + types + factory
// D-5-01 BINDING : abstraction testable, swappable Haiku↔Sonnet sans toucher les handlers
// llm-design.md §3 + architecture-sprint-5.md §1.5 D-5-01

// ============================================================
// Interface et types
// ============================================================

export interface LLMGenerateParams {
  systemPrompt: string
  userMessage: string
  maxTokens: number
  temperature: number
}

/**
 * Contrat d'interface LLM — consommé par les helpers reporting.
 * Implémenté par AnthropicClient en prod, MockLLMClient en test.
 * D-5-01 : swappable sans toucher les handlers ou les helpers.
 */
export interface ILLMClient {
  generate(params: LLMGenerateParams): Promise<string>
}

// ============================================================
// Erreur typée LLM
// ============================================================

/**
 * Erreur LLM propagée par les helpers reporting.
 * D-5-04 : throw → 502 en manuel, catch par-chantier dans le cron.
 * isTimeout : true si AbortController déclenche (timeout 30s)
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly isTimeout: boolean = false,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LLMError'
    // Préserve la stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

// ============================================================
// Factory
// ============================================================

let _cachedClient: ILLMClient | null = null
let _clientFactory: (() => ILLMClient) | null = null

/**
 * Enregistre la factory à utiliser par getLLMClient().
 * Appelé depuis les handlers Node (lib/llm/register.ts) pour injecter AnthropicClient
 * sans import statique côté Edge.
 * En test : non appelé — les helpers acceptent un ILLMClient en paramètre optionnel.
 */
export function registerLLMClientFactory(factory: () => ILLMClient): void {
  _clientFactory = factory
  _cachedClient = null
}

/**
 * Factory getLLMClient() — retourne le client enregistré ou lève si factory absente.
 * En prod : registerLLMClientFactory() est appelé depuis le premier handler Node.
 * En test : les helpers (genererContenuCR, genererContenuHebdo) acceptent un
 * ILLMClient en paramètre optionnel — getLLMClient() n'est jamais appelé.
 */
export function getLLMClient(): ILLMClient {
  if (_cachedClient) return _cachedClient
  if (!_clientFactory) {
    throw new LLMError('LLM client not registered. Call registerLLMClientFactory() on startup.')
  }
  _cachedClient = _clientFactory()
  return _cachedClient
}

/**
 * Réinitialise le singleton — utilisé uniquement en test.
 * Ne pas appeler en production.
 */
export function _resetLLMClientForTest(): void {
  _cachedClient = null
}
