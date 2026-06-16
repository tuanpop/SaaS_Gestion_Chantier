// PREMIER IMPORT ABSOLU : side-effect register LLM client (D-8-19 BINDING)
// Leçon commit 6041daf : singleton non vu par route handlers sans import co-localisé.
import '@/lib/llm/register'

// lib/chat/extraireAction.ts — Extraction payload Sonnet (étape 2 pipeline bot) + réponse @claw
// Sprint 8 : branché sur les prompts finaux Yuki (artifacts/09-llm/prompts/extraire-action/)
//
// EXI-Y-K8-01 BINDING : escapeDelimiter via buildUserMessageExtraction/buildUserMessageClaw (Yuki)
// EXI-Y-K8-02 BINDING : <message>...</message> + <data>...</data> via buildUserMessage* (Yuki)
// EXI-Y-K8-05 BINDING : parseActionPayloadSafe (Yuki) retourne null si invalide — jamais throw
// EXI-Y-K8-06 BINDING : Zod .strict() dans PayloadX (Yuki schema) rejette chantier_id/organisation_id
// EXI-Y-K8-07 BINDING : contexte borné 1 chantier/1 org (vient de construireContexteBot)
// D-7-11 BINDING : EXTRACTION_LLM_PARAMS.model = 'claude-sonnet-4-6' (Yuki, explicite)
// D-8-13 BINDING : executerAction jamais importé ici (S-8-09)
// RG-CLAW-004 : réponse @claw ≤1000 chars via parseClawReplySafe (Yuki)
// RG-CLAW-006 : RBAC ouvrier — contexte restreint aux tâches affectées (vient de construireContexteBot)
//
// AUDIT S-8-09 : grep executerAction dans ce fichier = 0

import { getLLMClient } from '@/lib/llm/client'
import { logger } from '@/lib/logger'
import { validatePayloadByType } from '@/lib/validation/chat'
import {
  buildUserMessageExtraction,
  buildUserMessageClaw,
  parseClawReplySafe,
  EXTRACTION_LLM_PARAMS,
  CLAW_REPLY_LLM_PARAMS,
  EXTRACTION_SYSTEM_PROMPT,
} from '@/lib/chat/prompts/extraire-action/schema'
import type { ActionType, ActionPayload, ContexteBot } from '@/types/chat'

// ============================================================
// extraireActionPayload — Sonnet extraction structurée
// EXI-Y-K8-05 BINDING : parseActionPayloadSafe → null si invalide
// EXI-Y-K8-06 BINDING : Zod .strict() rejette chantier_id/organisation_id
//
// Note sur le shape du payload :
//   - buildUserMessageExtraction (Yuki) indique à Sonnet de produire {"type":"creer_tache","titre":...}
//   - parseActionPayloadSafe (Yuki) valide avec schemas incluant le champ type
//   - validatePayloadByType (lib/validation/chat) valide SANS le champ type (pour l'INSERT DB)
//   - On strip le champ `type` du payload Yuki avant de retourner ActionPayload (types/chat.ts)
// ============================================================

export async function extraireActionPayload(
  contenu: string,
  contexte: ContexteBot,
  actionType: ActionType,
): Promise<ActionPayload | null> {
  // EXI-Y-K8-01/02 : buildUserMessageExtraction applique escapeDelimiter + délimiteurs <message>/<data>
  const userMessage = buildUserMessageExtraction(contenu, actionType, contexte)

  let rawResponse: string
  try {
    const llmClient = getLLMClient()
    rawResponse = await llmClient.generate({
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage,
      maxTokens: EXTRACTION_LLM_PARAMS.maxTokens,       // 400 (Yuki)
      temperature: EXTRACTION_LLM_PARAMS.temperature,   // 0.2 (Yuki)
      model: EXTRACTION_LLM_PARAMS.model,               // 'claude-sonnet-4-6' (D-7-11)
    })
  } catch (err) {
    logger.error(
      {
        actionType,
        error: err instanceof Error ? err.message : String(err),
      },
      'extraireActionPayload: erreur LLM Sonnet — proposition refusée',
    )
    return null
  }

  // Nettoyer la réponse (Sonnet peut ajouter des backticks markdown)
  const cleaned = rawResponse.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')

  // Parser JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (parseErr) {
    logger.error(
      {
        actionType,
        rawResponse: rawResponse.slice(0, 200),
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      },
      'extraireActionPayload: JSON Sonnet invalide — proposition refusée (EXI-Y-K8-05)',
    )
    return null
  }

  // Vérifier erreur INSUFFICIENT_INPUT (Sonnet peut retourner {"error":"INSUFFICIENT_INPUT",...})
  // parseActionPayloadSafe (Yuki) gère ce cas et retourne null
  // On fait la vérification INSUFFICIENT_INPUT ici via Yuki's parseActionPayloadSafe
  // Note : parseActionPayloadSafe attend aussi le champ `type` dans le payload (schema Yuki)
  // Pour compatibilité, on tente d'abord avec le payload tel quel, puis sans le champ `type` si besoin.
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'error' in (parsed as Record<string, unknown>) &&
    (parsed as Record<string, unknown>)['error'] === 'INSUFFICIENT_INPUT'
  ) {
    // INSUFFICIENT_INPUT — log info, retour null (pas d'INSERT)
    logger.warn(
      { actionType, reason: (parsed as Record<string, unknown>)['reason'] },
      'extraireActionPayload: INSUFFICIENT_INPUT — proposition refusée',
    )
    return null
  }

  // Strip du champ `type` (si Sonnet l'a inclus — schema Yuki) avant validatePayloadByType
  // validatePayloadByType (lib/validation/chat) utilise des schemas SANS le champ `type`
  // Le champ `type` est géré séparément dans action_proposals.type (injecté côté serveur)
  const payloadWithoutType: Record<string, unknown> = { ...(parsed as Record<string, unknown>) }
  delete payloadWithoutType['type']

  // Validation Zod strict (EXI-Y-K8-05 / EXI-Y-K8-06)
  // .strict() rejette chantier_id/organisation_id si injectés
  const validation = validatePayloadByType(actionType, payloadWithoutType)
  if (!validation.success) {
    logger.error(
      {
        actionType,
        zodError: 'error' in validation ? validation.error?.flatten() : undefined,
        rawResponse: rawResponse.slice(0, 200),
      },
      'extraireActionPayload: payload Zod invalide — proposition refusée (EXI-Y-K8-06)',
    )
    return null
  }

  return validation.data as ActionPayload
}

// ============================================================
// genererReponseClawInline — Sonnet, réponse textuelle @claw
// RG-CLAW-004 : ≤1000 chars via parseClawReplySafe (Yuki)
// RG-CLAW-006 : RBAC via contexte (ouvrier = tâches affectées seulement)
// EXI-Y-K8-07 : contexte borné 1 chantier/1 org (fourni par construireContexteBot)
// EXI-Y-K8-06 : réponse = string brut — rendu JSX pur côté UI
// ============================================================

export async function genererReponseClawInline(
  contenu: string,
  contexte: ContexteBot,
): Promise<string | null> {
  // EXI-Y-K8-01/02 : buildUserMessageClaw applique escapeDelimiter + délimiteurs <message>/<data>
  // Pour @claw, le `contenu` est le message original (qui contient @claw) — on passe le contenu
  // brut à buildUserMessageClaw qui l'échappera. La question nettoyée est dans intention.question
  // mais ici on a accès seulement au contenu brut.
  const userMessage = buildUserMessageClaw(contenu, contexte)

  let rawResponse: string
  try {
    const llmClient = getLLMClient()
    rawResponse = await llmClient.generate({
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage,
      maxTokens: CLAW_REPLY_LLM_PARAMS.maxTokens,       // 500 (Yuki)
      temperature: CLAW_REPLY_LLM_PARAMS.temperature,   // 0.3 (Yuki)
      model: CLAW_REPLY_LLM_PARAMS.model,               // 'claude-sonnet-4-6' (D-7-11)
    })
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'genererReponseClawInline: erreur LLM Sonnet',
    )
    return null
  }

  // parseClawReplySafe (Yuki) : tronque à 1000 chars (RG-CLAW-004)
  return parseClawReplySafe(rawResponse)
}
