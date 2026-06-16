// app/api/cron/derives/route.ts — POST /api/cron/derives
// Cron de détection proactive des dérives (Sprint 6, D-6-02)
// Exécuté par supercronic à 07h00 UTC quotidiennement (D-6-13 : pluriel 'derives').
//
// Sécurité :
//   TST-K6-07 : x-cron-secret comparé en timing-safe (crypto.timingSafeEqual) — jamais ===.
//     401 si header absent ou invalide.
//   TST-K6-08 : idempotence replay — ON CONFLICT DO NOTHING garantit 0 doublon.
//     Un replay le même jour → llm_appels=0 (pas de nouvelles dérives).
//   TST-K6-09 : aucun ciblage par body — itère déterministiquement tous chantiers actifs.
//   TST-K6-10 : org trial_expired → détection + notif fallback permises, LLM seul skippé.
//   TST-K6-33 : htmlEscape() appliqué sur titre+message avant insertNotification.
//   TST-K6-34 : destinataires = admins + conducteur rattaché (jamais ouvrier).
//
// D-008 BINDING : detecterDerives() est appelé AVANT genererMessageDerive().
//   Le LLM ne décide jamais d'une dérive — il reçoit des signaux déjà calculés.
// D-6-03 : genererMessageDerive() est best-effort — ne throw jamais le cron.
// D-6-04 : 1 appel LLM par chantier, UNIQUEMENT si ≥1 dérive nouvelle.
// D-6-12 : org trial_expired → skip LLM seul, détection + persistance maintenues.
//
// Déviation #1 : cast as unknown as sur derives_detectees (table non dans Database).
//   TODO: remove cast after supabase gen types post-mig-014.

export const runtime = 'nodejs'

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { chargerSeuils } from '@/lib/detection/chargerSeuils'
import { detecterDerives } from '@/lib/detection/detecterDerives'
import { genererMessageDerive } from '@/lib/detection/genererMessageDerive'
import { genererMessageFallback } from '@/lib/detection/genererMessageFallback'
import { insertNotification, resolveConducteurChantier } from '@/lib/notifications/notif'
import { checkTrialGate } from '@/lib/trial-gate'
import { logger } from '@/lib/logger'
import type { ReponseCronDerive, DeriveType, SignauxDeriveChantier } from '@/types/detection'
import type { ChantierActif } from '@/lib/detection/detecterDerives'

// ============================================================
// Vérification x-cron-secret (TST-K6-07 — timing-safe BINDING)
// ============================================================

function verifyCronSecret(request: NextRequest): boolean {
  const headerSecret = request.headers.get('x-cron-secret')
  const envSecret = process.env['CRON_SECRET']

  if (!headerSecret || !envSecret) {
    return false
  }

  // TST-K6-07 : timing-safe — jamais de comparaison avec ===
  // Encode les deux valeurs en Buffer UTF-8 pour timingSafeEqual
  const headerBuf = Buffer.from(headerSecret, 'utf8')
  const envBuf = Buffer.from(envSecret, 'utf8')

  // timingSafeEqual exige des buffers de même longueur
  if (headerBuf.length !== envBuf.length) {
    return false
  }

  return timingSafeEqual(headerBuf, envBuf)
}

// ============================================================
// Types internes
// ============================================================

interface DeriveActive {
  id: string
  type: DeriveType
  tache_id: string | null
}

// Clé de déduplication (type + tache_id ou null)
function deriveKey(type: DeriveType, tacheId: string | null): string {
  return `${type}::${tacheId ?? '__null__'}`
}

// ============================================================
// POST /api/cron/derives
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now()
  const reqLogger = logger.child({ route: 'POST /api/cron/derives' })

  // 1. Vérification x-cron-secret timing-safe (TST-K6-07 BINDING)
  if (!verifyCronSecret(request)) {
    reqLogger.warn({}, 'cron/derives: x-cron-secret absent ou invalide — 401')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TST-K6-09 : aucun ciblage par body — on n'appelle PAS request.json()
  // Le cron itère déterministiquement tous les chantiers actifs via adminClient.

  const adminClient = createAdminClient()

  // Compteurs de réponse
  const reponse: ReponseCronDerive = {
    chantiers_evalues: 0,
    chantiers_avec_derive: 0,
    chantiers_sans_derive: 0,
    chantiers_skipped_archive: 0,
    derives_nouvelles_total: 0,
    derives_resolues_total: 0,
    llm_appels: 0,
    llm_erreurs: 0,
    erreurs: [],
  }

  try {
    // 2. Charger tous les chantiers actifs (toutes orgs — adminClient bypass RLS)
    const { data: chantiersRaw, error: chantiersError } = await adminClient
      .from('chantiers')
      .select('id, organisation_id, nom, statut, budget_alloue, budget_depense, date_fin_prevue, updated_at')
      .eq('statut', 'actif')

    if (chantiersError) {
      reqLogger.error({ error: chantiersError.message }, 'cron/derives: erreur chargement chantiers')
      return NextResponse.json(
        { error: 'Erreur interne lors du chargement des chantiers.', reponse },
        { status: 500 },
      )
    }

    const chantiers = (chantiersRaw ?? []) as unknown as ChantierActif[]
    reqLogger.info({ nbChantiers: chantiers.length }, 'cron/derives: démarrage')

    // 3. Grouper par organisation_id (1 chargerSeuils par org)
    const orgMap = new Map<string, ChantierActif[]>()
    for (const chantier of chantiers) {
      const arr = orgMap.get(chantier.organisation_id) ?? []
      arr.push(chantier)
      orgMap.set(chantier.organisation_id, arr)
    }

    // 4. Itérer par organisation
    for (const [orgId, chantiersOrg] of orgMap.entries()) {
      // Charger les seuils une fois par org
      const seuilsEffectifs = await chargerSeuils(orgId, adminClient)

      // Vérifier trial gate pour cette org (TST-K6-10 : skip LLM seul)
      const trialResult = await checkTrialGate(adminClient, orgId)
      const isTrialExpired = trialResult.blocked

      // Itérer les chantiers de cette org
      for (const chantier of chantiersOrg) {
        reponse.chantiers_evalues++

        try {
          // 5a. Détecter les dérives (D-008 BINDING — ZÉRO LLM ici)
          const signaux: SignauxDeriveChantier = await detecterDerives(chantier, seuilsEffectifs, adminClient)

          // 5b. Charger les dérives actives existantes en base
          // TODO: remove cast after supabase gen types post-mig-014 (déviation #1)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: activesRaw, error: activesError } = await (adminClient as unknown as any)
            .from('derives_detectees')
            .select('id, type, tache_id')
            .eq('chantier_id', chantier.id)
            .is('resolved_at', null) as {
              data: DeriveActive[] | null
              error: { message: string } | null
            }

          if (activesError) {
            throw new Error(`Erreur lecture dérives actives: ${activesError.message}`)
          }

          const actives = activesRaw ?? []
          const activesKeys = new Set(actives.map((a) => deriveKey(a.type, a.tache_id)))

          // 5c. Diff — nouvelles vs résolues
          const nouvelles = signaux.derives.filter((signal) => {
            const tacheId = signal.type === 'tache_bloquee_longue' ? signal.tache_id : null
            return !activesKeys.has(deriveKey(signal.type, tacheId))
          })

          const signauxKeys = new Set(
            signaux.derives.map((s) => {
              const tacheId = s.type === 'tache_bloquee_longue' ? s.tache_id : null
              return deriveKey(s.type, tacheId)
            }),
          )

          const aResoudre = actives.filter((a) => !signauxKeys.has(deriveKey(a.type, a.tache_id)))

          // 5d. Traitement si nouvelles dérives
          if (nouvelles.length > 0) {
            reponse.chantiers_avec_derive++
            reponse.derives_nouvelles_total += nouvelles.length

            // Générer le message (LLM ou fallback selon trial gate)
            let messageLlm: string
            let messageLlmDb: string | null = null

            if (isTrialExpired) {
              // D-6-12 : trial_expired → skip LLM, fallback déterministe
              messageLlm = genererMessageFallback(signaux)
              reqLogger.debug({ orgId, chantierId: chantier.id }, 'cron/derives: trial_expired — skip LLM')
            } else {
              // D-6-04 : 1 appel LLM par chantier si ≥1 dérive nouvelle
              // D-6-03 BINDING : genererMessageDerive est best-effort — catch total en interne,
              // ne throw JAMAIS. Pas de try/catch externe (serait dead code).
              // llm_appels++ = nombre de tentatives LLM (la tentative a lieu même si KO interne).
              // Si LLM KO en interne, genererMessageDerive retourne le fallback et log lui-même l'erreur.
              // messageLlmDb = résultat LLM effectif (null si trial_expired — colonne nullable).
              reponse.llm_appels++
              messageLlm = await genererMessageDerive(signaux)
              messageLlmDb = messageLlm
            }

            // Insérer chaque nouvelle dérive (ON CONFLICT DO NOTHING — idempotence D-6-06)
            for (const signal of nouvelles) {
              const tacheId = signal.type === 'tache_bloquee_longue' ? signal.tache_id : null
              const signalValeur = getSignalValeur(signal)
              const signalUnite = getSignalUnite(signal)

              // TODO: remove cast after supabase gen types post-mig-014 (déviation #1)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { error: insertError } = await (adminClient as unknown as any)
                .from('derives_detectees')
                .insert({
                  organisation_id: orgId,
                  chantier_id: chantier.id,
                  type: signal.type,
                  tache_id: tacheId,
                  signal_valeur: signalValeur,
                  signal_unite: signalUnite,
                  message_llm: messageLlmDb,
                  detected_at: signaux.evaluated_at,
                })
                .onConflict?.('uq_derive_active_chantier_type_tache')
                // Note : Supabase JS ne supporte pas nativement ON CONFLICT DO NOTHING
                // avec les index partiels via .onConflict(). On utilise un upsert idempotent :
                // la contrainte unique partielle en DB garantit qu'un INSERT dupliqué échoue
                // silencieusement (erreur 23505). On catch et ignore le 23505.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ?? { error: null } as any

              if (insertError) {
                const pgCode = (insertError as unknown as { code?: string }).code
                if (pgCode === '23505') {
                  // Conflit d'unicité (dérive déjà active) — normal, idempotence attendue (D-6-06)
                  reqLogger.debug(
                    { chantierId: chantier.id, type: signal.type },
                    'cron/derives: INSERT ON CONFLICT — dérive déjà active (idempotence OK)',
                  )
                } else {
                  reqLogger.warn(
                    { chantierId: chantier.id, type: signal.type, error: (insertError as { message: string }).message },
                    'cron/derives: erreur INSERT dérive',
                  )
                }
              }
            }

            // Résoudre les destinataires et envoyer les notifications
            // TST-K6-34 : admins org + conducteur rattaché, jamais ouvrier
            // Note : resolveDestinatairesInternes retourne des emails (non utilisés ici — IDs résolus via resolveAdminIds)
            const conducteurId = await resolveConducteurChantier(adminClient, chantier.id, orgId)

            // Déduplication : ajouter le conducteur si pas déjà admin
            const destinatairesIds: string[] = []
            // Note : resolveDestinatairesInternes retourne des emails, mais insertNotification
            // attend des userId. On résout les IDs d'admins directement.
            const adminIds = await resolveAdminIds(orgId, adminClient)
            destinatairesIds.push(...adminIds)
            if (conducteurId && !destinatairesIds.includes(conducteurId)) {
              destinatairesIds.push(conducteurId)
            }

            if (destinatairesIds.length === 0) {
              reqLogger.warn(
                { chantierId: chantier.id, orgId },
                'cron/derives: aucun destinataire résolu — notification non insérée',
              )
            } else {
              // RG-DERIVE-015 : titre + message de la notification
              const nomTronque = chantier.nom.slice(0, 150)
              const titre = `Dérive détectée — ${nomTronque}`

              // TST-K6-33 / K4V-02 / RG-NOTIF-005 : htmlEscape() est appliqué DANS insertNotification
              // (étape 2, lignes 184-185 de lib/notifications/notif.ts) sur titre+message AVANT slice.
              // Ne PAS ré-appliquer htmlEscape ici — double-échappement produirait &amp;lt; au lieu de &lt;.
              // Vérifié par Zoro 2026-06-16 : la délégation à insertNotification est correcte et conforme
              // à D-4V-002 (point unique d'échappement). Voir DECISIONLOG entrée Zoro 2026-06-16.

              // Déterminer tache_id pour la notif (1 seule dérive tache_bloquee → tache_id, sinon null)
              const tacheBloqueeSinguliere =
                nouvelles.length === 1 && nouvelles[0]!.type === 'tache_bloquee_longue'
                  ? (nouvelles[0] as { tache_id: string }).tache_id
                  : null

              for (const destinataireId of destinatairesIds) {
                await insertNotification({
                  organisationId: orgId,
                  userId: destinataireId,
                  type: 'derive_proactive',
                  titre,
                  message: messageLlm,
                  chantierId: chantier.id,
                  tacheId: tacheBloqueeSinguliere,
                })
              }
            }
          } else {
            reponse.chantiers_sans_derive++
          }

          // 5e. Résoudre les dérives repassées sous seuil
          for (const derive of aResoudre) {
            // TODO: remove cast after supabase gen types post-mig-014 (déviation #1)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: resolveError } = await (adminClient as unknown as any)
              .from('derives_detectees')
              .update({ resolved_at: new Date().toISOString() })
              .eq('id', derive.id)
              .is('resolved_at', null) as { error: { message: string } | null }

            if (resolveError) {
              reqLogger.warn(
                { deriveId: derive.id, error: resolveError.message },
                'cron/derives: erreur résolution dérive — continuera au prochain cron',
              )
            } else {
              reponse.derives_resolues_total++
            }
          }
        } catch (chantierErr) {
          // Résilience par chantier : une erreur n'arrête pas les autres chantiers
          const msg = chantierErr instanceof Error ? chantierErr.message : String(chantierErr)
          reponse.erreurs.push(`chantier ${chantier.id}: ${msg}`)
          reqLogger.error(
            { chantierId: chantier.id, error: msg },
            'cron/derives: erreur par chantier (résistant) — passage suivant',
          )
        }
      }
    }

    const elapsed = Date.now() - startedAt
    reqLogger.info(
      { ...reponse, elapsed_ms: elapsed },
      'cron/derives: terminé',
    )

    return NextResponse.json(reponse, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    reqLogger.error({ error: msg }, 'cron/derives: erreur globale inattendue')
    return NextResponse.json(
      { error: 'Erreur interne du cron.', reponse },
      { status: 500 },
    )
  }
}

// ============================================================
// Helpers internes
// ============================================================

function getSignalValeur(signal: SignauxDeriveChantier['derives'][number]): number | null {
  switch (signal.type) {
    case 'budget_depasse': return signal.ratio
    case 'retard_date_fin': return signal.jours_retard
    case 'tache_bloquee_longue': return signal.jours_bloque
    case 'inactivite_chantier': return signal.jours_sans_activite
  }
}

function getSignalUnite(signal: SignauxDeriveChantier['derives'][number]): string | null {
  switch (signal.type) {
    case 'budget_depasse': return 'ratio'
    case 'retard_date_fin': return 'jours'
    case 'tache_bloquee_longue': return 'jours'
    case 'inactivite_chantier': return 'jours_sans_activite'
  }
}

/** Résout les IDs (pas emails) des admins d'une org */
async function resolveAdminIds(
  orgId: string,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<string[]> {
  try {
    const { data, error } = await adminClient
      .from('users')
      .select('id')
      .eq('organisation_id', orgId)
      .eq('role', 'admin')
      .is('deleted_at', null)

    if (error || !data) return []
    return (data as unknown as Array<{ id: string }>).map((u) => u.id)
  } catch {
    return []
  }
}
