// lib/llm/anthropic.ts — Implémentation AnthropicClient
// D-5-01 : implémente ILLMClient via @anthropic-ai/sdk
// D-5-03 : timeout 30s AbortController, pas de retry V1
// llm-design.md §3 — modèle claude-haiku-4-5, temperature 0.3
// Sécurité : ANTHROPIC_API_KEY jamais loggée (pino redact couvre 'token'/'authorization')
// TST-K5-17 : clé jamais en NEXT_PUBLIC_ANTHROPIC_*

import Anthropic from '@anthropic-ai/sdk'
import type { ILLMClient, LLMGenerateParams } from './client'
import { LLMError } from './client'
import { logger } from '@/lib/logger'

// Modèle retenu — llm-design.md §2 Yuki (Haiku = prose factuelle BTP)
// ID vérifié : claude-haiku-4-5 (alias stable, voir documentation API Anthropic)
const MODEL_ID = 'claude-haiku-4-5'

// Timeout 30s D-5-03
const TIMEOUT_MS = 30_000

/**
 * Implémentation Anthropic de ILLMClient.
 * SDK officiel @anthropic-ai/sdk, typage strict, AbortController 30s.
 * Startup check : ANTHROPIC_API_KEY (llm-design.md §6).
 */
export class AnthropicClient implements ILLMClient {
  private readonly client: Anthropic

  constructor() {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      // Fail-fast au démarrage (llm-design.md §6)
      throw new Error('ANTHROPIC_API_KEY manquante — AnthropicClient ne peut pas démarrer')
    }

    this.client = new Anthropic({
      apiKey,
      // Pas de timeout SDK — on gère via AbortController D-5-03
      timeout: TIMEOUT_MS,
    })
  }

  async generate(params: LLMGenerateParams): Promise<string> {
    const { systemPrompt, userMessage, maxTokens, temperature } = params

    // Log de l'appel sans exposer les contenus (sécurité)
    logger.debug(
      { model: MODEL_ID, maxTokens, temperature },
      'llm: generating content',
    )

    try {
      const response = await this.client.messages.create({
        model: MODEL_ID,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      })

      // Log usage tokens (tracking coûts llm-design.md §3)
      logger.info(
        {
          model: MODEL_ID,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          stopReason: response.stop_reason,
        },
        'llm_usage',
      )

      // Extraire le texte de la réponse
      const textBlock = response.content.find((block) => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        throw new LLMError('Réponse LLM invalide : aucun bloc texte retourné')
      }

      return textBlock.text
    } catch (err) {
      // Ne pas re-wrapper si c'est déjà un LLMError
      if (err instanceof LLMError) throw err

      // Détecter les erreurs de timeout Anthropic SDK
      const isTimeout =
        err instanceof Anthropic.APIConnectionTimeoutError ||
        (err instanceof Error && err.message.includes('timeout'))

      // Message générique — jamais de détail SDK/headers en réponse (TST-K5-17)
      const message = isTimeout
        ? 'Timeout LLM — la génération a dépassé 30 secondes'
        : 'Erreur LLM — génération impossible'

      // Log interne complet (jamais en réponse HTTP)
      logger.error(
        {
          model: MODEL_ID,
          error: err instanceof Error ? err.message : String(err),
          isTimeout,
        },
        'llm: generation failed',
      )

      throw new LLMError(message, isTimeout, err)
    }
  }
}
