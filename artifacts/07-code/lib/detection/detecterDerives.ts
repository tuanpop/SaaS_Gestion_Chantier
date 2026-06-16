// lib/detection/detecterDerives.ts — Fonctions de détection déterministes (D-008 BINDING)
// ZÉRO appel LLM dans ce fichier. Ces fonctions sont testables sans réseau.
// Le LLM est appelé APRÈS, à partir du SignauxDeriveChantier produit ici.
//
// 4 règles de dérive :
//   1. detecterDeriveBudget       — budget_depense / budget_alloue > ratio_budget
//   2. detecterDeriveRetard       — date_fin_prevue < today AND statut='actif'
//   3. detecterDerivesTacheBloquee— tâche statut='bloque' depuis > jours_blocage
//   4. detecterDeriveInactivite   — aucune activité depuis > jours_inactivite
//
// Sécurité :
//   D-051 / EXI-Y-K6-02 / TST-K6-02 BINDING :
//     detecterDerivesTacheBloquee fait un SELECT EXPLICITE des colonnes —
//     jamais select('*'), jamais note_privee_conducteur dans le SELECT.
//   D-045 BINDING : jamais de filtre taches.deleted_at IS NULL (colonne inexistante).
//   V-07 BINDING : inactivité passe par taches→photos.tache_id (pas photos.chantier_id).
//   V-09 BINDING : tous les calculs UTC. Jamais toLocaleDateString().
//
// Déviation #1 (dette typée) : cast as unknown as sur requêtes Supabase tables nouvelles.
//   TODO: remove cast after supabase gen types post-mig-014.

import type {
  SeuilsEffectifs,
  SignalDeriveBudget,
  SignalDeriveRetard,
  SignalDeriveTacheBloquee,
  SignalDeriveInactivite,
  SignauxDeriveChantier,
} from '@/types/detection'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

// ============================================================
// Constante plafond tâches bloquées (D-6-14 — anti-flood)
// N_MAX_TACHES_BLOQUEES = 5 : seules les 5 tâches les plus anciennes par chantier/passage cron.
// Les restantes seront détectées au passage suivant si encore bloquées.
// ============================================================

export const N_MAX_TACHES_BLOQUEES = 5

// ============================================================
// Helpers UTC (V-09 BINDING)
// ============================================================

/** Retourne la date UTC actuelle au format YYYY-MM-DD */
function todayUTC(): string {
  return new Date().toISOString().split('T')[0]!
}

/** Calcule le nombre de jours entre deux timestamps en ms (UTC, arrondi à l'inférieur) */
function joursDepuis(isoDate: string): number {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  return Math.floor((now - then) / 86_400_000)
}

/** Calcule le nombre de jours de retard (date_fin_prevue → today, toutes dates UTC) */
function joursRetard(dateFin: string): number {
  const today = new Date(todayUTC() + 'T00:00:00.000Z').getTime()
  const fin = new Date(dateFin + 'T00:00:00.000Z').getTime()
  return Math.floor((today - fin) / 86_400_000)
}

// ============================================================
// Type interne — Chantier tel que chargé par le cron
// ============================================================

export interface ChantierActif {
  id: string
  organisation_id: string
  nom: string
  statut: string
  budget_alloue: number | null
  budget_depense: number
  date_fin_prevue: string | null
  updated_at: string
}

// ============================================================
// 1. Dérive budget (RG-DERIVE-003)
// ============================================================

/**
 * Détecte une dérive budget pour un chantier.
 * Skip si budget_alloue IS NULL ou = 0 (RG-DERIVE-019 — loggue debug skipped_no_budget).
 */
export function detecterDeriveBudget(
  chantier: ChantierActif,
  seuils: SeuilsEffectifs,
): SignalDeriveBudget | null {
  const { budget_alloue, budget_depense } = chantier

  // RG-DERIVE-019 : skip si budget non défini ou nul
  if (budget_alloue === null || budget_alloue === 0) {
    logger.debug(
      { chantierId: chantier.id, skipped_no_budget: true },
      'detecterDeriveBudget: skipped_no_budget',
    )
    return null
  }

  const ratio = budget_depense / budget_alloue

  if (ratio > seuils.ratio_budget) {
    return {
      type: 'budget_depasse',
      budget_alloue,
      budget_depense,
      ratio,
      depassement_eur: budget_depense - budget_alloue,
      seuil_applique: seuils.ratio_budget,
    }
  }

  return null
}

// ============================================================
// 2. Dérive retard date de fin (RG-DERIVE-004)
// ============================================================

/**
 * Détecte une dérive retard pour un chantier actif.
 * Dérive si date_fin_prevue IS NOT NULL ET date_fin_prevue < today (UTC).
 * Aucun seuil configurable — tout dépassement est une dérive.
 */
export function detecterDeriveRetard(
  chantier: ChantierActif,
): SignalDeriveRetard | null {
  const { date_fin_prevue } = chantier

  if (!date_fin_prevue) {
    return null
  }

  // V-09 BINDING : comparaison UTC
  const today = todayUTC()
  if (date_fin_prevue >= today) {
    return null
  }

  const jours = joursRetard(date_fin_prevue)
  if (jours <= 0) {
    return null
  }

  return {
    type: 'retard_date_fin',
    date_fin_prevue,
    jours_retard: jours,
  }
}

// ============================================================
// 3. Dérive tâche bloquée longue (RG-DERIVE-005)
// ============================================================

/**
 * Détecte les tâches bloquées depuis plus de jours_blocage jours.
 * Retourne au max N_MAX_TACHES_BLOQUEES signaux (les plus anciennes — D-6-14).
 *
 * D-051 / EXI-Y-K6-02 BINDING :
 *   SELECT explicite des colonnes — jamais select('*').
 *   note_privee_conducteur n'est PAS dans le SELECT.
 *
 * D-045 BINDING :
 *   Pas de filtre deleted_at IS NULL sur taches (colonne inexistante).
 */
export async function detecterDerivesTacheBloquee(
  chantierId: string,
  seuils: SeuilsEffectifs,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<SignalDeriveTacheBloquee[]> {
  // V-09 : seuil en ms
  const seuilMs = seuils.jours_blocage * 86_400_000
  const seuilDate = new Date(Date.now() - seuilMs).toISOString()

  try {
    // D-051 BINDING : SELECT explicite — id, titre, updated_at UNIQUEMENT.
    // Jamais select('*') qui inclurait note_privee_conducteur.
    // D-045 BINDING : pas de filtre deleted_at IS NULL.
    const { data, error } = await adminClient
      .from('taches')
      .select('id, titre, updated_at')
      .eq('chantier_id', chantierId)
      .eq('statut', 'bloque')
      .lt('updated_at', seuilDate)
      .order('updated_at', { ascending: true })  // les plus anciennes en premier (D-6-14)
      .limit(N_MAX_TACHES_BLOQUEES)

    if (error) {
      logger.warn(
        { chantierId, error: error.message },
        'detecterDerivesTacheBloquee: erreur DB — aucun signal retourné',
      )
      return []
    }

    if (!data || data.length === 0) {
      return []
    }

    // Mapping explicite champ par champ — note_privee_conducteur structurellement absent (EXI-Y-K6-02)
    return data.map((t) => {
      const tache = t as unknown as { id: string; titre: string; updated_at: string }
      const jours = joursDepuis(tache.updated_at)

      const signal: SignalDeriveTacheBloquee = {
        type: 'tache_bloquee_longue',
        tache_id: tache.id,
        tache_titre: tache.titre.slice(0, 200),  // max 200 chars
        jours_bloque: jours,
        seuil_applique: seuils.jours_blocage,
      }

      return signal
    })
  } catch (err) {
    logger.warn(
      { chantierId, err: err instanceof Error ? err.message : String(err) },
      'detecterDerivesTacheBloquee: exception inattendue — aucun signal retourné',
    )
    return []
  }
}

// ============================================================
// 4. Dérive inactivité chantier (RG-DERIVE-006)
// ============================================================

/**
 * Détecte une dérive inactivité pour un chantier actif.
 *
 * Algorithme (V-07 BINDING — photos via tache_id) :
 *   1. Récupérer les IDs des tâches du chantier
 *   2. Si 0 tâches → fallback chantiers.updated_at
 *   3. Sinon : MAX(taches.updated_at) et MAX(photos.created_at WHERE tache_id IN ids)
 *   4. Dérive si la dernière activité (max des deux) > jours_inactivite jours
 *
 * D-045 BINDING : pas de filtre deleted_at IS NULL sur taches.
 * V-07 BINDING : jamais photos.chantier_id (colonne inexistante).
 */
export async function detecterDeriveInactivite(
  chantier: ChantierActif,
  seuils: SeuilsEffectifs,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<SignalDeriveInactivite | null> {
  const chantierId = chantier.id

  try {
    // Étape 1 : récupérer les IDs des tâches du chantier
    // D-045 BINDING : pas de filtre deleted_at
    const { data: tachesData, error: tachesError } = await adminClient
      .from('taches')
      .select('id, updated_at')
      .eq('chantier_id', chantierId)

    if (tachesError) {
      logger.warn(
        { chantierId, error: tachesError.message },
        'detecterDeriveInactivite: erreur DB tâches — fallback updated_at chantier',
      )
      return evaluerInactivite(chantier.updated_at, seuils, chantier.updated_at)
    }

    const taches = (tachesData ?? []) as unknown as Array<{ id: string; updated_at: string }>

    // Étape 2 : si 0 tâches → fallback chantiers.updated_at
    if (taches.length === 0) {
      logger.debug(
        { chantierId },
        'detecterDeriveInactivite: aucune tâche — fallback chantiers.updated_at',
      )
      return evaluerInactivite(chantier.updated_at, seuils, chantier.updated_at)
    }

    // Étape 3a : MAX(taches.updated_at)
    const maxTacheUpdatedAt = taches.reduce((max, t) => {
      return t.updated_at > max ? t.updated_at : max
    }, taches[0]!.updated_at)

    // Étape 3b : MAX(photos.created_at WHERE tache_id IN (tache_ids))
    // V-07 BINDING : via tache_id, JAMAIS photos.chantier_id
    const tacheIds = taches.map((t) => t.id)

    let maxPhotoCreatedAt: string | null = null

    if (tacheIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: photosData, error: photosError } = await (adminClient as unknown as any)
        .from('photos')
        .select('created_at')
        .in('tache_id', tacheIds)
        .order('created_at', { ascending: false })
        .limit(1) as {
          data: Array<{ created_at: string }> | null
          error: { message: string } | null
        }

      if (photosError) {
        logger.warn(
          { chantierId, error: photosError.message },
          'detecterDeriveInactivite: erreur DB photos — utilisation taches.updated_at seul',
        )
      } else if (photosData && photosData.length > 0) {
        maxPhotoCreatedAt = photosData[0]!.created_at
      }
    }

    // Étape 4 : dernière activité = max(maxTacheUpdatedAt, maxPhotoCreatedAt)
    let derniereActivite = maxTacheUpdatedAt
    if (maxPhotoCreatedAt && maxPhotoCreatedAt > maxTacheUpdatedAt) {
      derniereActivite = maxPhotoCreatedAt
    }

    return evaluerInactivite(derniereActivite, seuils, chantier.updated_at)
  } catch (err) {
    logger.warn(
      { chantierId, err: err instanceof Error ? err.message : String(err) },
      'detecterDeriveInactivite: exception inattendue — fallback updated_at chantier',
    )
    return evaluerInactivite(chantier.updated_at, seuils, chantier.updated_at)
  }
}

// Helper interne — évaluation finale inactivité (V-09 : calcul UTC)
function evaluerInactivite(
  derniereActiviteIso: string,
  seuils: SeuilsEffectifs,
  _fallbackIso: string,
): SignalDeriveInactivite | null {
  const jours = joursDepuis(derniereActiviteIso)

  if (jours <= seuils.jours_inactivite) {
    return null
  }

  // Extraire la date ISO (YYYY-MM-DD) pour le signal
  const derniereActiviteDate = derniereActiviteIso.split('T')[0] ?? null

  return {
    type: 'inactivite_chantier',
    jours_sans_activite: jours,
    derniere_activite: derniereActiviteDate,
    seuil_applique: seuils.jours_inactivite,
  }
}

// ============================================================
// Fonction agrégat — detecterDerives (D-6-01, D-008 BINDING)
// Retourne SignauxDeriveChantier avec toutes les dérives calculées.
// ZÉRO appel LLM — le LLM est appelé par le cron APRÈS cette fonction.
// ============================================================

/**
 * Détecte toutes les dérives pour un chantier actif.
 * Retourne SignauxDeriveChantier avec la liste des signaux calculés.
 *
 * D-008 BINDING : aucun appel LLM ici. Le LLM est appelé après dans le cron.
 * D-6-01 : séparation détection (cette lib) / rédaction (genererMessageDerive).
 */
export async function detecterDerives(
  chantier: ChantierActif,
  seuils: SeuilsEffectifs,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<SignauxDeriveChantier> {
  const derives = []

  // 1. Dérive budget
  const signalBudget = detecterDeriveBudget(chantier, seuils)
  if (signalBudget) derives.push(signalBudget)

  // 2. Dérive retard
  const signalRetard = detecterDeriveRetard(chantier)
  if (signalRetard) derives.push(signalRetard)

  // 3. Tâches bloquées (async, plafonnées à N_MAX_TACHES_BLOQUEES)
  const signalsTacheBloquee = await detecterDerivesTacheBloquee(chantier.id, seuils, adminClient)
  derives.push(...signalsTacheBloquee)

  // 4. Inactivité chantier (async, passe par taches→photos.tache_id)
  const signalInactivite = await detecterDeriveInactivite(chantier, seuils, adminClient)
  if (signalInactivite) derives.push(signalInactivite)

  const snapshot: SignauxDeriveChantier = {
    chantier_id: chantier.id,
    chantier_nom: chantier.nom.slice(0, 200),
    organisation_id: chantier.organisation_id,
    seuils,
    evaluated_at: new Date().toISOString(),
    derives,
  }

  logger.debug(
    {
      chantierId: chantier.id,
      orgId: chantier.organisation_id,
      nbDerives: derives.length,
      types: derives.map((d) => d.type),
    },
    'detecterDerives: snapshot calculé',
  )

  return snapshot
}
