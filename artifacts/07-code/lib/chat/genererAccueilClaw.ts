// PREMIER IMPORT ABSOLU : side-effect register LLM client (D-8-19 BINDING)
// Leçon commit 6041daf : singleton non vu par route handlers sans import co-localisé.
import '@/lib/llm/register'

// lib/chat/genererAccueilClaw.ts — Génération accueil Claw pour ouvrier (Feature #9)
// Sprint 8 : branché sur les prompts finaux Yuki (artifacts/09-llm/prompts/accueil-claw/)
//
// D-8-16 BINDING : best-effort TOTAL — toute erreur → return null (scan QR jamais bloqué)
// D-8-18 : trial_expired → contenu déterministe sans Haiku (llm_utilise=false)
// D-051 BINDING : note_privee_conducteur absent du SELECT — colonnes explicites
//   grep "note_privee" dans ce fichier = 0
// D-045 BINDING : taches n'a pas de deleted_at — jamais de filtre deleted_at IS NULL
// EXI-Y-K8-01 : escapeDelimiter via buildUserMessageAccueil (Yuki schema)
// RG-ACCUEIL-003 : SELECT tâches colonnes explicites (id, titre, statut, date_echeance)
// RG-ACCUEIL-007 : llm_utilise = false si trial fallback
// Réutilise meteo_cache Sprint 7 (0 appel OpenWeather)

import { getLLMClient } from '@/lib/llm/client'
import { checkTrialGate } from '@/lib/trial-gate'
import { logger } from '@/lib/logger'
import {
  buildUserMessageAccueil,
  parseAccueilOutputSafe,
  genererAccueilFallback,
  ACCUEIL_LLM_PARAMS,
  ACCUEIL_SYSTEM_PROMPT,
} from '@/lib/chat/prompts/accueil-claw/schema'
import type { TacheAccueil } from '@/lib/chat/prompts/accueil-claw/schema'
import type { ContenuAccueilClaw } from '@/types/chat'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// ============================================================
// Types
// ============================================================

interface GenererAccueilClawResult {
  contenu: string
  meteo_disponible: boolean
  llm_utilise: boolean
}

interface MeteoCache {
  data: {
    temperature?: number
    temperature_min?: number
    temperature_max?: number
    description?: string
    conditions?: string
    precip_mm?: number
    vent_kmh?: number
    alerte_pluie?: boolean
    alerte_gel?: boolean
    alerte_canicule?: boolean
    alerte_vent?: boolean
  }
}

// ============================================================
// genererAccueilClaw
// D-8-16 : best-effort absolu — catch tout en interne, jamais throw
// D-8-19 : register.ts co-localisé EN PREMIER
// ============================================================

export async function genererAccueilClaw(
  ouvrierUserId: string,
  chantier: {
    id: string
    nom: string
    code_postal: string | null
    organisation_id: string
  },
  adminClient: AdminClient,
): Promise<GenererAccueilClawResult | null> {
  try {
    // ── 1. Récupérer infos ouvrier (prénom pour l'accueil) ───────────────
    const { data: ouvrierRow, error: ouvrierError } = await (adminClient as unknown as AdminClient)
      .from('users')
      .select('id, prenom, nom')
      .eq('id', ouvrierUserId)
      .is('deleted_at', null)
      .maybeSingle() as unknown as {
        data: { id: string; prenom: string; nom: string } | null
        error: { message: string } | null
      }

    if (ouvrierError || !ouvrierRow) {
      logger.warn({ ouvrierUserId }, 'genererAccueilClaw: ouvrier introuvable')
      return null
    }

    // ── 2. Récupérer tâches de l'ouvrier — colonnes explicites (D-051) ──
    // RG-ACCUEIL-003 : id, titre, statut, date_echeance — NOTE PRIVEE ABSENT (D-051)
    // D-045 : taches n'a pas de deleted_at — pas de filtre deleted_at IS NULL
    const { data: tachesRaw, error: tachesError } = await (adminClient as unknown as AdminClient)
      .from('taches')
      .select('id, titre, statut, date_echeance')
      .eq('assigned_to', ouvrierUserId)
      .eq('chantier_id', chantier.id)
      .eq('organisation_id', chantier.organisation_id)
      .neq('statut', 'termine') // D-045 : enum TacheStatut = 'termine' (pas 'terminee')
      .limit(10) as unknown as {  // Yuki AccueilInputSchema.taches.max(10)
        data: Array<{ id: string; titre: string; statut: string; date_echeance: string | null }> | null
        error: { message: string } | null
      }

    if (tachesError) {
      logger.warn({ ouvrierUserId, error: tachesError.message }, 'genererAccueilClaw: erreur lecture tâches')
    }

    // Filtrer statuts valides pour TacheAccueilSchema ('a_faire' | 'en_cours' | 'bloque')
    // (neq('statut','termine') déjà filtré en DB — mais statut 'termine' ne doit pas passer)
    const taches: TacheAccueil[] = (tachesRaw ?? [])
      .filter(t => ['a_faire', 'en_cours', 'bloque'].includes(t.statut))
      .map(t => ({
        id: t.id,
        titre: t.titre,
        statut: t.statut as 'a_faire' | 'en_cours' | 'bloque',
        date_echeance: t.date_echeance,
      }))

    // ── 3. Météo depuis cache Sprint 7 (lecture seule, 0 appel OpenWeather) ──
    let meteoData: {
      temperature_min: number | null
      temperature_max: number | null
      description: string | null
      alerte_pluie: boolean
      alerte_gel: boolean
      alerte_canicule: boolean
      alerte_vent: boolean
    } | null = null
    let meteo_disponible = false

    if (chantier.code_postal) {
      try {
        const sixHeuresAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
        const { data: meteoRow } = await (adminClient as unknown as AdminClient)
          .from('meteo_cache')
          .select('data')
          .eq('code_postal', chantier.code_postal)
          .gte('fetched_at', sixHeuresAgo)
          .maybeSingle() as unknown as {
            data: MeteoCache | null
            error: unknown
          }

        if (meteoRow?.data) {
          const d = meteoRow.data
          const tempMin = d.temperature_min ?? (d.temperature !== undefined ? d.temperature - 3 : null)
          const tempMax = d.temperature_max ?? (d.temperature !== undefined ? d.temperature + 3 : null)
          const desc = d.description ?? d.conditions ?? null

          if (desc !== null) {
            meteoData = {
              temperature_min: tempMin ?? null,
              temperature_max: tempMax ?? null,
              description: desc,
              alerte_pluie: d.alerte_pluie ?? false,
              alerte_gel: d.alerte_gel ?? false,
              alerte_canicule: d.alerte_canicule ?? false,
              alerte_vent: d.alerte_vent ?? false,
            }
            meteo_disponible = true
          }
        }
      } catch {
        // Best-effort météo — ne pas bloquer
      }
    }

    // ── 4. Trial-gate (D-8-18) ─────────────────────────────────────────
    const trialResult = await checkTrialGate(adminClient, chantier.organisation_id)
    const trialExpired = trialResult.blocked

    // ── 5. Génération contenu ──────────────────────────────────────────
    const dateAccueil = new Date().toISOString().split('T')[0] ?? ''
    let contenuTexte: string
    let llm_utilise = false

    if (trialExpired) {
      // Fallback déterministe sans Haiku (D-8-18 / RG-ACCUEIL-007)
      // genererAccueilFallback (Yuki) — déterministe
      contenuTexte = genererAccueilFallback(ouvrierRow.prenom, taches, dateAccueil)
      llm_utilise = false
    } else {
      // Génération Haiku (ACCUEIL_LLM_PARAMS de Yuki — model défaut = Haiku)
      try {
        const llmClient = getLLMClient()

        // buildUserMessageAccueil (Yuki) : applique escapeDelimiter sur prénom et titres (EXI-Y-K8-01)
        const accueilInput = {
          ouvrier_id: ouvrierUserId,
          ouvrier_prenom: ouvrierRow.prenom,
          taches,
          meteo: meteoData,
          date_accueil: dateAccueil,
        }

        const userMessage = buildUserMessageAccueil(accueilInput)

        const generated = await llmClient.generate({
          systemPrompt: ACCUEIL_SYSTEM_PROMPT,
          userMessage,
          maxTokens: ACCUEIL_LLM_PARAMS.maxTokens,       // 300 (Yuki)
          temperature: ACCUEIL_LLM_PARAMS.temperature,   // 0.4 (Yuki)
          // model non spécifié → défaut Haiku (D-7-11 BINDING — ACCUEIL_LLM_PARAMS ne le spécifie pas)
        })

        // parseAccueilOutputSafe (Yuki) : tronque à 1000 chars, null si trop court
        const parsed = parseAccueilOutputSafe(generated)
        if (parsed === null) {
          // Sortie trop courte → fallback déterministe (D-8-16)
          logger.warn(
            { ouvrierUserId, rawLength: generated.length },
            'genererAccueilClaw: output Haiku trop court — fallback déterministe',
          )
          contenuTexte = genererAccueilFallback(ouvrierRow.prenom, taches, dateAccueil)
          llm_utilise = false
        } else {
          contenuTexte = parsed
          llm_utilise = true
        }
      } catch (llmErr) {
        // Best-effort LLM : fallback déterministe (D-8-16)
        logger.warn(
          { ouvrierUserId, error: llmErr instanceof Error ? llmErr.message : String(llmErr) },
          'genererAccueilClaw: Haiku KO — fallback déterministe',
        )
        contenuTexte = genererAccueilFallback(ouvrierRow.prenom, taches, dateAccueil)
        llm_utilise = false
      }
    }

    return {
      contenu: contenuTexte,
      meteo_disponible,
      llm_utilise,
    }
  } catch (err) {
    // D-8-16 : catch global — jamais throw (le scan QR doit toujours réussir)
    logger.warn(
      {
        ouvrierUserId,
        error: err instanceof Error ? err.message : String(err),
      },
      'genererAccueilClaw: erreur inattendue — best-effort silencieux',
    )
    return null
  }
}

// ============================================================
// buildContenuAccueilClaw — convertit en ContenuAccueilClaw pour les tests
// ============================================================

export function buildContenuAccueilClaw(
  prenom: string,
  taches: Array<{ titre: string; statut: string; date_echeance: string | null }>,
  meteoResume: string | null,
): ContenuAccueilClaw {
  return {
    message_principal: `Bonjour ${prenom} !`,
    taches_du_jour: taches.map((t) => ({
      titre: t.titre,   // JAMAIS note_privee_conducteur (D-051)
      statut: t.statut,
      date_echeance: t.date_echeance,
    })),
    meteo_resume: meteoResume,
    meteo_disponible: meteoResume !== null,
  }
}
