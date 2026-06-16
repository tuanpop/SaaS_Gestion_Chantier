// IMPORTANT : import side-effect register EN PREMIER — V-15 / leçon commit 6041daf
// Garantit que AnthropicClient est enregistré dans getLLMClient() avant tout appel
// (isolation module Next.js — mémoire nextjs-instrumentation-module-isolation)
import '@/lib/llm/register'

// lib/briefing/genererContenuBriefing.ts — Génération du contenu briefing via LLM Sonnet
// D-7-04 BINDING : best-effort — JAMAIS de throw vers le cron
// D-7-05 : 1 appel Sonnet agrégé par chantier (1 SignauxBriefingChantier → 1 texte)
// D-7-11 : passe model: 'claude-sonnet-4-6' — défaut Haiku INCHANGÉ dans AnthropicClient
// EXI-Y-K7-01/02/03 : escapeDelimiter + <data> + déclaration non fiable (dans prompts/)
// TST-K7-04 : reçoit UN SEUL SignauxBriefingChantier (1 chantier, 1 org) — pas d'exfil cross-org

import { getLLMClient } from '@/lib/llm/client'
import { logger } from '@/lib/logger'
import type { SignauxBriefingChantier } from '@/types/briefing'
import {
  BRIEFING_SYSTEM_PROMPT,
  buildBriefingUserMessage,
  BRIEFING_LLM_PARAMS,
  BriefingOutputSchema,
} from './prompts/briefing-chantier'
import { genererMessageFallbackBriefing } from './genererMessageFallbackBriefing'

/**
 * Génère le contenu textuel du briefing via LLM Sonnet.
 * Best-effort (D-7-04) : tout échec LLM ou output invalide → retourne le message fallback déterministe.
 * Ne throw jamais vers le cron.
 *
 * Validation Zod de l'output LLM (BriefingOutputSchema) avant retour :
 *   - trop court (< 100 chars) → fallback (D-7-04)
 *   - trop long (> 8000 chars) → fallback (D-7-04 / specs §2.2 CHECK DB)
 *
 * @param signaux - SignauxBriefingChantier (1 chantier, 1 org — TST-K7-04)
 * @returns { contenu: string; llmUtilise: boolean }
 */
export async function genererContenuBriefing(
  signaux: SignauxBriefingChantier,
): Promise<{ contenu: string; llmUtilise: boolean }> {
  try {
    const userMessage = buildBriefingUserMessage(signaux)

    logger.debug(
      {
        chantierId: signaux.chantier_id,
        model: 'claude-sonnet-4-6',
        maxTokens: BRIEFING_LLM_PARAMS.maxTokens,
        temperature: BRIEFING_LLM_PARAMS.temperature,
      },
      'genererContenuBriefing: appel LLM Sonnet',
    )

    const contenuBrut = await getLLMClient().generate({
      systemPrompt: BRIEFING_SYSTEM_PROMPT,
      userMessage,
      maxTokens: BRIEFING_LLM_PARAMS.maxTokens,
      temperature: BRIEFING_LLM_PARAMS.temperature,
      model: 'claude-sonnet-4-6',  // D-7-11 — ne change PAS le défaut Haiku d'AnthropicClient
    })

    // Validation Zod de l'output LLM (EXI-Y-K7-04 / D-7-04 best-effort)
    // Si invalide (trop court ou dépassement DB) → fallback déterministe, ne throw jamais
    const parsed = BriefingOutputSchema.safeParse(contenuBrut)
    if (!parsed.success) {
      logger.warn(
        {
          chantierId: signaux.chantier_id,
          validationErrors: parsed.error.flatten(),
          contenuLength: contenuBrut.length,
        },
        'genererContenuBriefing: output LLM invalide (BriefingOutputSchema) — fallback déterministe (D-7-04)',
      )
      const contenu = genererMessageFallbackBriefing(signaux)
      return { contenu, llmUtilise: false }
    }

    logger.info(
      {
        chantierId: signaux.chantier_id,
        contenuLength: parsed.data.length,
        model: 'claude-sonnet-4-6',
      },
      'genererContenuBriefing: contenu généré avec succès',
    )

    return { contenu: parsed.data, llmUtilise: true }
  } catch (err) {
    // D-7-04 BINDING : catch interne — jamais throw vers le cron
    // Log interne — jamais le détail SDK/headers (TST-K7-30)
    logger.warn(
      {
        chantierId: signaux.chantier_id,
        err: err instanceof Error ? err.message : String(err),
      },
      'genererContenuBriefing: LLM KO — fallback déterministe (best-effort)',
    )

    // Fallback déterministe (D-7-04 / RG-BRIEFING-007)
    const contenu = genererMessageFallbackBriefing(signaux)
    return { contenu, llmUtilise: false }
  }
}
