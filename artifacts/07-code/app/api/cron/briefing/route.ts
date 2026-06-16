// app/api/cron/briefing/route.ts — Cron génération briefings lundi matin
// D-7-03 : cron app-level supercronic, lundi 06h30 UTC
// RG-BRIEFING-001→015 : règles métier complètes
// Sécurité : x-cron-secret timing-safe (TST-K7-12), skip-si-existant AVANT météo/LLM (TST-K7-13),
//            annee_iso/semaine_iso calculés côté serveur (TST-K7-14), best-effort par chantier (TST-K7-16)

export const runtime = 'nodejs'

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getIsoWeek, getIsoYear } from '@/lib/reporting/isoWeek'
import { checkTrialGate } from '@/lib/trial-gate'
import { fetchMeteo } from '@/lib/briefing/fetchMeteo'
import { collecterSignaux } from '@/lib/briefing/collecterSignaux'
import { genererContenuBriefing } from '@/lib/briefing/genererContenuBriefing'
import { genererMessageFallbackBriefing } from '@/lib/briefing/genererMessageFallbackBriefing'
import { resolveDestinatairesInternes } from '@/lib/reporting/destinataires'
import { insertNotification } from '@/lib/notifications/notif'
import type { ReponseCronBriefing } from '@/types/briefing'

// ============================================================
// Types DB internes
// ============================================================

interface ChantierActifRow {
  id: string
  organisation_id: string
  nom: string
  statut: string
  code_postal: string
}

// ============================================================
// POST /api/cron/briefing
// ============================================================

export async function POST(request: Request): Promise<Response> {
  // ── Auth x-cron-secret timing-safe (TST-K7-12) ──────────────────────────────
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) {
    logger.error('CRON_SECRET manquant — endpoint cron/briefing inaccessible')
    return NextResponse.json({ error: 'Configuration serveur invalide' }, { status: 500 })
  }

  const receivedSecret = request.headers.get('x-cron-secret') ?? ''

  // comparaison timing-safe (TST-K7-12 — évite timing attack)
  let secretOk = false
  try {
    const a = Buffer.from(receivedSecret)
    const b = Buffer.from(cronSecret)
    // crypto.timingSafeEqual exige des buffers de même longueur
    if (a.length === b.length) {
      secretOk = crypto.timingSafeEqual(a, b)
    }
  } catch {
    secretOk = false
  }

  if (!secretOk) {
    logger.warn({ path: '/api/cron/briefing' }, 'cron/briefing: secret invalide ou absent — 401')
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  // ── Initialisation ───────────────────────────────────────────────────────────
  const adminClient = createAdminClient()

  // annee_iso + semaine_iso calculés côté serveur UTC — JAMAIS depuis le body (TST-K7-14)
  const now = new Date()
  const anneeIso = getIsoYear(now)
  const semaineIso = getIsoWeek(now)

  logger.info({ anneeIso, semaineIso }, 'cron/briefing: démarrage')

  const reponse: ReponseCronBriefing = {
    chantiers_evalues: 0,
    briefings_generes: 0,
    briefings_skipped_existants: 0,
    // chantiers_skipped_archive retiré (F002 Zoro) — champ trompeur, toujours 0
    // (le cron charge uniquement statut='actif', les archivés ne sont jamais évalués)
    chantiers_skipped_trial_expired: 0,
    llm_appels: 0,
    llm_erreurs: 0,
    meteo_appels_api: 0,
    meteo_hits_cache: 0,
    meteo_erreurs: 0,
    erreurs: [],
  }

  try {
    // ── Charger tous les chantiers actifs (toutes orgs) ──────────────────────────
    // Itération déterministe — AUCUN ciblage par body (TST-K7-14)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantiersRaw, error: chantiersError } = await (adminClient as unknown as any)
      .from('chantiers')
      .select('id, organisation_id, nom, statut, code_postal')
      .eq('statut', 'actif')
      .order('created_at', { ascending: true }) as { data: ChantierActifRow[] | null; error: { message: string } | null }

    if (chantiersError) {
      logger.error({ err: chantiersError.message }, 'cron/briefing: erreur chargement chantiers')
      return NextResponse.json({ error: 'Erreur chargement chantiers' }, { status: 500 })
    }

    const chantiers = chantiersRaw ?? []
    reponse.chantiers_evalues = chantiers.length

    logger.info({ nbChantiers: chantiers.length, anneeIso, semaineIso }, 'cron/briefing: chantiers chargés')

    // ── Traitement par chantier ───────────────────────────────────────────────────
    for (const chantier of chantiers) {
      try {
        // Étape 1 : skip-si-existant AVANT météo/LLM (TST-K7-13 — économie d'appels API)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingRaw } = await (adminClient as unknown as any)
          .from('briefings')
          .select('id')
          .eq('chantier_id', chantier.id)
          .eq('annee_iso', anneeIso)
          .eq('semaine_iso', semaineIso)
          .maybeSingle() as { data: { id: string } | null }

        if (existingRaw !== null) {
          reponse.briefings_skipped_existants++
          logger.debug(
            { chantierId: chantier.id, anneeIso, semaineIso },
            'cron/briefing: briefing déjà existant — skip',
          )
          continue
        }

        // Étape 2 : fetchMeteo (best-effort — D-7-07)
        let meteoSource: 'api' | 'cache' | 'indisponible' = 'indisponible'
        const meteo = await fetchMeteo(chantier.code_postal, adminClient)

        if (meteo.source === 'api') {
          reponse.meteo_appels_api++
          meteoSource = 'api'
        } else if (meteo.source === 'cache') {
          reponse.meteo_hits_cache++
          meteoSource = 'cache'
        } else {
          reponse.meteo_erreurs++
          meteoSource = 'indisponible'
        }

        const meteoDisponible = meteo.source !== 'indisponible'

        logger.debug({ chantierId: chantier.id, meteoSource }, 'cron/briefing: météo récupérée')

        // Étape 3 : collecterSignaux (aucun appel LLM — D-008)
        const signaux = await collecterSignaux(adminClient, chantier.id, meteo, anneeIso, semaineIso)

        // Étape 4 : trial-gate (D-7-08 / RG-BRIEFING-004)
        const trialResult = await checkTrialGate(adminClient, chantier.organisation_id)
        let contenuGenere: string | null = null
        let messageFallback: string | null = null
        let llmUtilise = false

        if (trialResult.blocked) {
          // Trial expiré : fallback déterministe, pas d'appel Sonnet (D-7-08)
          reponse.chantiers_skipped_trial_expired++
          messageFallback = genererMessageFallbackBriefing(signaux)
          logger.info(
            { chantierId: chantier.id, orgId: chantier.organisation_id },
            'cron/briefing: trial_expired — fallback sans LLM',
          )
        } else {
          // Appel LLM Sonnet (best-effort — D-7-04)
          reponse.llm_appels++
          const { contenu, llmUtilise: utilise } = await genererContenuBriefing(signaux)

          if (utilise) {
            contenuGenere = contenu
            llmUtilise = true
          } else {
            // LLM KO — fallback
            reponse.llm_erreurs++
            messageFallback = contenu
          }
        }

        // Étape 5 : INSERT ON CONFLICT DO NOTHING (D-7-01 idempotence)
        const donneesBrutes = {
          chantier_nom: signaux.chantier_nom,
          budget_ratio: signaux.budget_ratio,
          jours_restants_fin: signaux.jours_restants_fin,
          derives_actives: signaux.derives_actives,
          jalons_semaine: signaux.jalons_semaine,
          seuil_budget: signaux.seuil_budget,
          generated_at: signaux.generated_at,
          // note_privee_conducteur JAMAIS ici (D-051 BINDING)
        }

        const meteoSnapshot = meteoDisponible ? { jours: signaux.meteo.jours } : null

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: insertedRaw, error: insertError } = await (adminClient as unknown as any)
          .from('briefings')
          .insert({
            organisation_id: chantier.organisation_id,
            chantier_id: chantier.id,
            annee_iso: anneeIso,
            semaine_iso: semaineIso,
            contenu_genere: contenuGenere,
            message_fallback: messageFallback,
            donnees_brutes: donneesBrutes,
            meteo_snapshot: meteoSnapshot,
            code_postal: chantier.code_postal,
            llm_utilise: llmUtilise,
            meteo_disponible: meteoDisponible,
          })
          .select('id')
          .maybeSingle() as { data: { id: string } | null; error: { message: string; code?: string } | null }

        // ON CONFLICT DO NOTHING — si code 23505 (unique violation) → skip silencieux
        if (insertError && insertError.code !== '23505') {
          logger.warn(
            { chantierId: chantier.id, err: insertError.message },
            'cron/briefing: erreur INSERT briefing (best-effort)',
          )
          reponse.erreurs.push(`chantier ${chantier.id}: erreur INSERT — ${insertError.message}`)
          continue
        }

        const briefingId = insertedRaw?.id ?? null

        if (insertedRaw) {
          reponse.briefings_generes++
          logger.info(
            { chantierId: chantier.id, briefingId, llmUtilise, meteoDisponible },
            'cron/briefing: briefing inséré',
          )
        }

        // Étape 6 : notifications (best-effort — D-4V-002)
        if (insertedRaw) {
          await envoyerNotificationsBriefing(
            adminClient,
            chantier.id,
            chantier.organisation_id,
            chantier.nom,
            semaineIso,
            contenuGenere ?? messageFallback ?? '',
            briefingId,
          )
        }
      } catch (err) {
        // Résilient par chantier — une erreur ne bloque pas les autres (TST-K7-16)
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.error(
          { chantierId: chantier.id, err: errMsg },
          'cron/briefing: erreur non gérée sur chantier (best-effort — suite du cron)',
        )
        reponse.erreurs.push(`chantier ${chantier.id}: ${errMsg.substring(0, 200)}`)
      }
    }

    // ── Nettoyage cache météo > 24h (D-7-14 / RG-METEO-009 best-effort) ─────────
    try {
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cleanupError } = await (adminClient as unknown as any)
        .from('meteo_cache')
        .delete()
        .lt('fetched_at', cutoff24h) as { error: { message: string } | null }

      if (cleanupError) {
        logger.warn(
          { err: cleanupError.message },
          'cron/briefing: cleanup meteo_cache KO (best-effort)',
        )
      } else {
        logger.debug('cron/briefing: cleanup meteo_cache > 24h effectué')
      }
    } catch (cleanupErr) {
      logger.warn(
        { err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) },
        'cron/briefing: cleanup meteo_cache exception (best-effort)',
      )
    }

    // Observabilité quota OpenWeather — EXI-Y-K7-09 (TST-K7-10)
    // Alerte si > 200 appels API météo dans ce passage cron (plan gratuit = 1000/jour)
    if (reponse.meteo_appels_api > 200) {
      logger.warn(
        { meteo_appels_api: reponse.meteo_appels_api },
        'cron/briefing: meteo_appels_api > 200, surveiller quota OpenWeather',
      )
    }

    logger.info(reponse, 'cron/briefing: terminé')
    return NextResponse.json(reponse, { status: 200 })
  } catch (err) {
    // Erreur critique globale — rare (ex: DB complètement down)
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'cron/briefing: erreur critique globale',
    )
    return NextResponse.json({ error: 'Erreur interne serveur' }, { status: 500 })
  }
}

// ============================================================
// Envoi notifications briefing_lundi (best-effort)
// RG-BRIEFING-009/012 : admins + conducteur rattaché, jamais ouvrier
// htmlEscape sur titre/message (RG-NOTIF-005 / TST-K7-28)
// ============================================================

async function envoyerNotificationsBriefing(
  adminClient: ReturnType<typeof createAdminClient>,
  chantierId: string,
  orgId: string,
  chantierNom: string,
  semaineIso: number,
  contenu: string,
  briefingId: string | null,
): Promise<void> {
  try {
    // Résoudre les destinataires : admins org + conducteur rattaché, deleted_at IS NULL, jamais ouvrier
    // resolveDestinatairesInternes retourne des emails — on doit résoudre les user_id depuis les emails
    const emails = await resolveDestinatairesInternes(orgId, chantierId, adminClient)

    if (emails.length === 0) {
      logger.warn({ chantierId, orgId }, 'cron/briefing: aucun destinataire pour notif briefing')
      return
    }

    // Résoudre user_id à partir des emails (resolveDestinatairesInternes retourne des emails)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: usersRaw } = await (adminClient as unknown as any)
      .from('users')
      .select('id, email')
      .eq('organisation_id', orgId)
      .in('email', emails)
      .is('deleted_at', null) as { data: Array<{ id: string; email: string }> | null }

    if (!usersRaw || usersRaw.length === 0) {
      logger.warn({ chantierId, orgId }, 'cron/briefing: aucun user_id résolu pour notif briefing')
      return
    }

    // Titre et message — htmlEscape obligatoire (RG-NOTIF-005 / RG-BRIEFING-009 / TST-K7-28)
    const titreRaw = `Briefing semaine ${semaineIso} — ${chantierNom}`
    // Extraire les 2-3 premières phrases du contenu (max 1000 chars — RG-BRIEFING-009)
    const messageRaw = extraireExtrait(contenu, 1000)

    // insertNotification gère htmlEscape en interne — on passe les valeurs brutes
    // (htmlEscape dans insertNotification.ts étape 2 — K4V-02)
    const notifIds: string[] = []

    for (const user of usersRaw) {
      await insertNotification({
        organisationId: orgId,
        userId: user.id,
        type: 'briefing_lundi',
        titre: titreRaw.substring(0, 200),
        message: messageRaw,
        chantierId,
        tacheId: null,
      })
      notifIds.push(user.id)
    }

    // Mettre à jour notification_ids dans le briefing si briefingId disponible
    if (briefingId && notifIds.length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (adminClient as unknown as any)
          .from('briefings')
          .update({ notification_ids: notifIds })
          .eq('id', briefingId)
      } catch {
        // best-effort — audit non critique
      }
    }

    logger.debug(
      { chantierId, nbDestinataires: usersRaw.length },
      'cron/briefing: notifications briefing_lundi envoyées',
    )
  } catch (err) {
    // best-effort — jamais throw (D-4V-002)
    logger.warn(
      { chantierId, orgId, err: err instanceof Error ? err.message : String(err) },
      'cron/briefing: erreur notifications (best-effort)',
    )
  }
}

// ============================================================
// Extraire un extrait du contenu (2-3 premières phrases)
// ============================================================

function extraireExtrait(contenu: string, maxChars: number): string {
  if (!contenu) return ''

  // Prendre les premiers caractères, couper sur une phrase si possible
  const extrait = contenu.substring(0, maxChars)

  // Si on a tronqué, essayer de couper sur la dernière phrase complète
  if (contenu.length > maxChars) {
    const dernierPoint = extrait.lastIndexOf('.')
    const dernierBR = extrait.lastIndexOf('\n')
    const coupe = Math.max(dernierPoint, dernierBR)
    if (coupe > maxChars * 0.5) {
      return extrait.substring(0, coupe + 1).trim()
    }
    return extrait.trim() + '...'
  }

  return extrait.trim()
}
