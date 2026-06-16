// PREMIER IMPORT ABSOLU : side-effect register LLM client (D-8-19 BINDING)
// Leçon commit 6041daf Sprint 5 : singleton enregistré au boot N'EST PAS vu par les route handlers
// sans cet import co-localisé. Mémoire nextjs-instrumentation-module-isolation.
import '@/lib/llm/register'

// lib/chat/detecterIntention.ts — Tri d'intention Haiku (étape 1 pipeline bot)
// Sprint 8 : branché sur les prompts finaux Yuki (artifacts/09-llm/prompts/detecter-intention/)
//
// EXI-Y-K8-01 BINDING : escapeDelimiter via buildUserMessageIntention (Yuki schema)
// EXI-Y-K8-02 BINDING : séparation instructions/données (<message>...</message>) via buildUserMessageIntention
// EXI-Y-K8-03 BINDING : system prompt INTENTION_SYSTEM_PROMPT (Yuki) déclare <message> non fiable
// EXI-Y-K8-05 BINDING : fallback {type:'neutre'} via parseIntentionSafe (Yuki)
// D-8-12 BINDING : Haiku = défaut AnthropicClient (INTENTION_LLM_PARAMS ne spécifie pas model)
//   Haiku ne construit jamais le payload — il détecte uniquement l'intention.
// D-8-19 BINDING : import side-effect register.ts EN PREMIER ABSOLU

import { getLLMClient } from '@/lib/llm/client'
import { logger } from '@/lib/logger'
import {
  buildUserMessageIntention,
  parseIntentionSafe,
  INTENTION_LLM_PARAMS,
  INTENTION_SYSTEM_PROMPT,
} from '@/lib/chat/prompts/detecter-intention/schema'
import type { IntentionBot } from '@/types/chat'

// ============================================================
// detecterIntention — appel Haiku, retourne IntentionBot
// EXI-Y-K8-01/02 : buildUserMessageIntention construit le user message avec escapeDelimiter
// EXI-Y-K8-05 : parseIntentionSafe retourne {type:'neutre'} si JSON invalide (jamais throw)
// D-8-12 : INTENTION_LLM_PARAMS ne spécifie pas model → défaut Haiku
// ============================================================

export async function detecterIntention(contenu: string): Promise<IntentionBot> {
  // EXI-Y-K8-01/02 : buildUserMessageIntention applique escapeDelimiter + encapsule dans <message>
  const userMessage = buildUserMessageIntention(contenu)

  let rawResponse: string

  try {
    const llmClient = getLLMClient()
    rawResponse = await llmClient.generate({
      systemPrompt: INTENTION_SYSTEM_PROMPT,
      userMessage,
      maxTokens: INTENTION_LLM_PARAMS.maxTokens,       // 80 (Yuki)
      temperature: INTENTION_LLM_PARAMS.temperature,   // 0.1 (Yuki)
      // model non spécifié → défaut Haiku (D-8-12 BINDING — INTENTION_LLM_PARAMS ne le spécifie pas)
    })
  } catch (err) {
    // Best-effort : erreur LLM → fallback neutre (EXI-Y-K8-05 / D-8-11)
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'detecterIntention: erreur LLM Haiku — fallback neutre',
    )
    return { type: 'neutre' }
  }

  // Nettoyer la réponse (Haiku peut parfois ajouter des backticks markdown)
  const cleaned = rawResponse.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')

  // parseIntentionSafe : fallback {type:'neutre'} si JSON invalide ou hors-schéma (EXI-Y-K8-05)
  const intention = parseIntentionSafe(cleaned)

  // Mapper IntentionBotYuki → IntentionBot (types/chat.ts) — structures compatibles
  // IntentionBotYuki et IntentionBot ont le même shape (union discriminée identique)
  // Le cast est sûr : parseIntentionSafe garantit une valeur valide
  if (intention.type === 'neutre') {
    return { type: 'neutre' }
  }

  if (intention.type === 'claw_inline') {
    const question = intention.question ?? ''
    if (question.length > 200) {
      logger.warn(
        { questionLength: question.length },
        'detecterIntention: question @claw > 200 chars — tronquée',
      )
    }
    return { type: 'claw_inline', question: question.slice(0, 200) }
  }

  if (intention.type === 'action_a_proposer') {
    // action_type est validé par Zod dans parseIntentionSafe (ActionTypeSchema)
    return { type: 'action_a_proposer', action_type: intention.action_type }
  }

  // Fallback de sécurité (ne devrait pas arriver — parseIntentionSafe retourne toujours un type valide)
  logger.warn({ intention }, 'detecterIntention: type inattendu après parseIntentionSafe — fallback neutre')
  return { type: 'neutre' }
}
