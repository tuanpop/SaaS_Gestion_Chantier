// PREMIER IMPORT ABSOLU : side-effect register LLM client (D-8-19 BINDING)
// Leçon commit 6041daf : singleton non vu par route handlers sans import co-localisé.
// CRITIQUE : doit être le PREMIER import, avant TOUT autre (pas même les types).
import '@/lib/llm/register'

// lib/chat/pipeline-bot.ts — Orchestrateur fire-and-forget pipeline Haiku → Sonnet
//
// D-8-13 BINDING : "Bot proposes, human executes"
//   executerAction JAMAIS importé dans ce fichier (S-8-09 BINDING).
//   Le pipeline crée des propositions pending — seul PATCH .../valider exécute.
//   AUDIT S-8-09 : grep executerAction dans ce fichier = 0
//
// D-8-12 BINDING : Haiku = défaut (detecterIntention), Sonnet = explicite (extraireAction)
// D-8-17 BINDING : Rate-limit 10 Sonnet/h/chantier via checkRateLimit
//   Clé : 'sonnet-chat:${chantierId}'
//   Fenêtre : 3600s. Skip Sonnet si dépassé → message bot d'information.
//
// D-8-16 : Best-effort — toute erreur interne ne remonte pas au caller (fire-and-forget)
//   POST message → 201 immediate → void lancerPipelineBot() (sans await)
//
// D-8-11 : Trial-gate skip — LLM features skippées mais le message reste enregistré
// EXI-Y-K8-01 : escapeDelimiter appliqué dans detecterIntention + extraireAction
// EXI-Y-K8-05 : fallbacks sûrs dans detecterIntention si JSON Haiku invalide
// RG-CHAT-009 : message bot inséré en type='bot' via adminClient (bypass RLS)
// RG-CHAT-010 : message système inséré si rate-limit atteint

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { checkRateLimit } from '@/lib/cache'
import { checkTrialGate } from '@/lib/trial-gate'
import { construireContexteBot } from '@/lib/chat/construireContexteBot'
import { detecterIntention } from '@/lib/chat/detecterIntention'
import { extraireActionPayload, genererReponseClawInline } from '@/lib/chat/extraireAction'
import {
  insertNotification,
  resolveConducteurChantier,
  resolveAdminsOrg,
} from '@/lib/notifications/notif'
import type { IntentionBot } from '@/types/chat'
import type { NotificationType } from '@/types/database'

// D-8-17 : Rate-limit Sonnet
const SONNET_RATE_LIMIT = {
  limit: 10,
  windowMs: 60 * 60 * 1000, // 1 heure
} as const

// ============================================================
// lancerPipelineBot — point d'entrée fire-and-forget
// Appelé SANS await depuis POST /api/chantiers/[id]/chat/messages
// Ne throw JAMAIS — toute erreur est loggée silencieusement (D-8-16)
// ============================================================

export async function lancerPipelineBot(params: {
  messageId: string
  contenu: string
  chantierId: string
  chatId: string
  organisationId: string
  roleAppelant: 'admin' | 'conducteur' | 'ouvrier'
  ouvrierUserId?: string
}): Promise<void> {
  const {
    messageId,
    contenu,
    chantierId,
    chatId,
    organisationId,
    roleAppelant,
    ouvrierUserId,
  } = params

  const logCtx = {
    messageId,
    chantierId,
    organisationId,
    roleAppelant,
  }

  try {
    const adminClient = createAdminClient()

    // ── 1. Trial-gate — skip LLM si trial expiré (D-8-11) ────────────────
    const trialResult = await checkTrialGate(adminClient, organisationId)
    if (trialResult.blocked) {
      logger.info(logCtx, 'pipeline-bot: trial expiré — skip pipeline LLM')
      return
    }

    // ── 2. Détection intention Haiku (étape 1 — toujours Haiku) ─────────
    let intention: IntentionBot
    try {
      intention = await detecterIntention(contenu)
    } catch (err) {
      // Best-effort : detecterIntention ne devrait jamais throw (elle catch en interne)
      // Mais par sécurité (D-8-16)
      logger.error(
        { ...logCtx, error: err instanceof Error ? err.message : String(err) },
        'pipeline-bot: detecterIntention throw inattendu — fallback neutre',
      )
      intention = { type: 'neutre' }
    }

    logger.info(
      { ...logCtx, intention_type: intention.type },
      'pipeline-bot: intention détectée',
    )

    // ── 3. Neutre → rien à faire ─────────────────────────────────────────
    if (intention.type === 'neutre') {
      logger.debug(logCtx, 'pipeline-bot: intention neutre — pas de message bot')
      return
    }

    // ── 4. Sonnet nécessaire → vérifier rate-limit D-8-17 ───────────────
    const rateLimitKey = `sonnet-chat:${chantierId}`
    const rateLimitResult = checkRateLimit({
      key: rateLimitKey,
      limit: SONNET_RATE_LIMIT.limit,
      windowMs: SONNET_RATE_LIMIT.windowMs,
    })

    if (!rateLimitResult.allowed) {
      logger.warn(
        { ...logCtx, remaining: rateLimitResult.remaining },
        'pipeline-bot: rate-limit Sonnet atteint — message info inséré',
      )
      // RG-CHAT-010 : message système rate-limit
      await insererMessageBot(
        adminClient,
        chatId,
        chantierId,
        null,
        '[Claw est temporairement limité sur ce chantier. Réessaie dans une heure.]',
        'system',
      )
      return
    }

    // ── 5. Construire contexte bot (Sonnet besoin de données chantier) ───
    const contexte = await construireContexteBot(
      chantierId,
      organisationId,
      roleAppelant,
      adminClient,
      ouvrierUserId,
    )

    if (!contexte) {
      logger.error(logCtx, 'pipeline-bot: contexte bot introuvable — abandon')
      return
    }

    // ── 6A. @claw inline → réponse Sonnet → message bot ─────────────────
    if (intention.type === 'claw_inline') {
      const reponse = await genererReponseClawInline(contenu, contexte)

      if (!reponse) {
        logger.warn(logCtx, 'pipeline-bot: genererReponseClawInline → null — pas de message bot')
        return
      }

      // Insérer message bot avec la réponse Claw inline
      await insererMessageBot(
        adminClient,
        chatId,
        chantierId,
        messageId,
        reponse,
        'bot',
      )

      logger.info(logCtx, 'pipeline-bot: réponse @claw inline insérée')
      return
    }

    // ── 6B. Action à proposer → extraction Sonnet → proposition pending ─
    if (intention.type === 'action_a_proposer') {
      const { action_type } = intention

      // Extraction payload via Sonnet (EXI-Y-K8-05/06 : Zod strict dans extraireAction)
      const payload = await extraireActionPayload(contenu, contexte, action_type)

      if (!payload) {
        logger.warn(
          { ...logCtx, action_type },
          'pipeline-bot: payload extraction nulle — pas de proposition créée',
        )
        // Ne pas insérer de message bot d'erreur — confus pour l'utilisateur
        return
      }

      // D-8-13 BINDING : créer la proposition en 'pending' uniquement
      // JAMAIS appeler executerAction ici (S-8-09 BINDING)
      // IDOR : chantier_id + organisation_id figés ici (serveur), jamais du payload
      const { data: propositionRow, error: propositionError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
        .from('action_proposals')
        .insert({
          organisation_id: organisationId,  // D-8-14 : source serveur, jamais du payload
          chantier_id: chantierId,           // D-8-14 : source serveur, jamais du payload
          message_id: messageId,
          type: action_type,
          payload: payload as unknown as import('@/types/database').Json,  // ActionPayload structurellement compatible Json — double cast nécessaire (D-8-14)
          statut: 'pending',
        })
        .select('id')
        .single() as unknown as {
          data: { id: string } | null
          error: { message: string } | null
        }

      if (propositionError || !propositionRow) {
        logger.error(
          {
            ...logCtx,
            action_type,
            error: propositionError?.message,
          },
          'pipeline-bot: erreur insertion proposition action — abandon',
        )
        return
      }

      const propositionId = propositionRow.id

      // US-080 / RG-BOT-008 : notification action_proposal aux conducteurs du chantier
      // Best-effort total — ne bloque pas le pipeline si KO (D-8-16)
      // PO-4V-03 BINDING : jamais d'ouvrier dans les destinataires
      try {
        const actionTypeLabel: Record<string, string> = {
          creer_tache: 'Créer une tâche',
          ajouter_cr: 'Ajouter au compte-rendu',
          replanifier: 'Replanifier',
          alerte: 'Envoyer une alerte',
        }
        const titreNotif = `Claw a proposé une action — ${actionTypeLabel[action_type] ?? action_type}`
        const messageNotif = 'Une nouvelle proposition est en attente de validation.'

        const destinataireIds: string[] = []

        // Conducteur(s) du chantier (RG-BOT-008 : conducteurs rattachés)
        const conducteurId = await resolveConducteurChantier(adminClient, chantierId, organisationId)
        if (conducteurId) {
          destinataireIds.push(conducteurId)
        }

        // Admins de l'organisation (RG-BOT-008 : conducteurs + admins)
        const adminIds = await resolveAdminsOrg(adminClient, organisationId)
        destinataireIds.push(...adminIds)

        const uniqueIds = [...new Set(destinataireIds)]

        for (const userId of uniqueIds) {
          await insertNotification({
            organisationId,
            userId,
            type: 'action_proposal' as NotificationType,
            titre: titreNotif,
            message: messageNotif,
            chantierId,
            tacheId: null,
          })
        }

        logger.info(
          { ...logCtx, propositionId, destinataireCount: uniqueIds.length },
          'pipeline-bot: notification action_proposal envoyée aux conducteurs (US-080)',
        )
      } catch (notifErr) {
        // Best-effort — ne jamais bloquer le pipeline (D-8-16)
        logger.warn(
          {
            ...logCtx,
            propositionId,
            error: notifErr instanceof Error ? notifErr.message : String(notifErr),
          },
          'pipeline-bot: notification action_proposal KO — non-bloquant (best-effort)',
        )
      }

      // Lier la proposition au message source
      const { error: updateMsgError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
        .from('messages')
        .update({ action_proposal_id: propositionId })
        .eq('id', messageId)
        .eq('chantier_id', chantierId) as unknown as { error: { message: string } | null }

      if (updateMsgError) {
        logger.warn(
          {
            ...logCtx,
            propositionId,
            error: updateMsgError.message,
          },
          'pipeline-bot: erreur liaison action_proposal_id sur message — non-bloquant',
        )
        // Non-bloquant : la proposition existe, le lien sur le message est cosmétique
      }

      // Insérer message bot de confirmation (type='bot')
      const confirmationBot = buildConfirmationMessage(action_type)
      await insererMessageBot(
        adminClient,
        chatId,
        chantierId,
        messageId,
        confirmationBot,
        'bot',
      )

      logger.info(
        { ...logCtx, action_type, propositionId },
        'pipeline-bot: proposition créée en pending + message bot de confirmation',
      )
      return
    }

    // Fallback : intention inconnue (ne devrait pas arriver)
    logger.warn(
      { ...logCtx, intention },
      'pipeline-bot: intention inconnue — abandon silencieux',
    )
  } catch (err) {
    // D-8-16 : catch global — ne jamais throw (fire-and-forget)
    logger.error(
      {
        ...logCtx,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      'pipeline-bot: erreur non gérée — abandon silencieux (fire-and-forget)',
    )
  }
}

// ============================================================
// insererMessageBot — insert message type bot/system via adminClient
// Bypass RLS WITH CHECK(false) (D-8-03/04)
// ============================================================

async function insererMessageBot(
  adminClient: ReturnType<typeof createAdminClient>,
  chatId: string,
  chantierId: string,
  sourceMessageId: string | null,
  contenu: string,
  type: 'bot' | 'system',
): Promise<void> {
  const { error } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
    .from('messages')
    .insert({
      chat_id: chatId,
      chantier_id: chantierId,
      auteur_id: null,           // bot = pas d'auteur humain
      auteur_nom: 'Claw',
      auteur_role: null,
      type,
      contenu: contenu.slice(0, 4000), // CHECK constraint messages
      action_proposal_id: null,
    }) as unknown as { error: { message: string } | null }

  if (error) {
    logger.error(
      {
        chatId,
        chantierId,
        type,
        sourceMessageId,
        error: error.message,
      },
      'insererMessageBot: erreur insertion message bot',
    )
  }
}

// ============================================================
// buildConfirmationMessage — message bot selon type d'action
// ============================================================

function buildConfirmationMessage(actionType: string): string {
  switch (actionType) {
    case 'creer_tache':
      return "J'ai detécté une nouvelle tâche à créer. Le conducteur peut valider ou modifier la proposition dans l'onglet Propositions."
    case 'ajouter_cr':
      return "J'ai détécté un signal pour le compte-rendu. Le conducteur peut valider l'ajout dans l'onglet Propositions."
    case 'replanifier':
      return "J'ai détécté une demande de replanification. Le conducteur peut valider ou modifier la proposition dans l'onglet Propositions."
    case 'alerte':
      return "J'ai détécté une alerte. Le conducteur peut valider et envoyer la notification dans l'onglet Propositions."
    default:
      return "J'ai détécté une action à proposer. Le conducteur peut la valider dans l'onglet Propositions."
  }
}
