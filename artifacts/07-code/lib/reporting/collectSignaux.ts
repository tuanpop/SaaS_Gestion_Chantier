// lib/reporting/collectSignaux.ts — Collecte déterministe des signaux terrain
// D-008 BINDING : collecte pure TS, jamais d'appel LLM
// D-5-06 : mapping explicite champ par champ — JAMAIS select('*') ni spread d'objet source
// TST-K5-03 : champs confidentiels structurellement absents du SELECT et du résultat
// Troncature 100 tâches : priorité modifiées_jour > bloque > en_cours > a_faire > termine

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SignauxTerrain, SignalTache, SignalPhoto, SignalBudget } from '@/types/reporting'
import { calculerCouleur } from '@/lib/coloration'
import { logger } from '@/lib/logger'

// Limite de tâches envoyées au LLM (specs §8 edge case)
const MAX_TACHES = 100

// Type structurel minimal pour le client Supabase admin
type AdminClient = Pick<SupabaseClient<Database>, 'from'>

// ============================================================
// Collecte principale
// ============================================================

/**
 * Collecte déterministe des signaux terrain pour un (chantier_id, date_cr).
 * D-008 : fonction pure TS, aucun appel LLM.
 * Retourne un has_activity pour le court-circuit cron (RG-CR-008).
 *
 * Exclusions structurelles :
 *   - Champs confidentiels conduite interne : jamais collectés (D-051/PO-014)
 *   - Chemins et URLs de stockage : jamais collectés (D-4-006)
 *   - Données cross-org : impossible (filtre chantier_id + organisation_id)
 */
export async function collectSignaux(
  adminClient: AdminClient,
  chantierId: string,
  organisationId: string,
  dateCr: string, // YYYY-MM-DD
): Promise<SignauxTerrain & { has_activity: boolean }> {
  const generatedAt = new Date().toISOString()

  // ── 1. Récupérer le chantier (nom + budget) ──────────────────────────────
  const { data: chantierRaw, error: chantierError } = await (adminClient as SupabaseClient<Database>)
    .from('chantiers')
    .select('id, nom, budget_alloue, budget_depense, date_fin_prevue')
    .eq('id', chantierId)
    .eq('organisation_id', organisationId)
    .single()

  if (chantierError || !chantierRaw) {
    logger.error(
      { chantierId, organisationId, error: chantierError?.message },
      'collectSignaux: chantier introuvable',
    )
    throw new Error(`Chantier introuvable : ${chantierId}`)
  }

  // Budget déterministe via calculerCouleur (D-008)
  const couleur = calculerCouleur(
    {
      date_fin_prevue: chantierRaw.date_fin_prevue,
      budget_alloue: chantierRaw.budget_alloue ?? null,
      budget_depense: chantierRaw.budget_depense ?? 0,
    },
    new Date(dateCr),
  )

  const budget: SignalBudget = {
    alloue: chantierRaw.budget_alloue ?? null,
    depense: chantierRaw.budget_depense ?? null,
    ecart:
      chantierRaw.budget_alloue !== null && chantierRaw.budget_depense !== null
        ? (chantierRaw.budget_depense ?? 0) - chantierRaw.budget_alloue
        : null,
    couleur,
  }

  // ── 2. Récupérer les tâches du chantier ──────────────────────────────────
  // Mapping explicite champ par champ — JAMAIS select('*') (TST-K5-03)
  // Champs confidentiels structurellement absents du SELECT (D-051/PO-014, D-008)
  const { data: tachesRaw } = await (adminClient as SupabaseClient<Database>)
    .from('taches')
    .select(`
      id,
      titre,
      statut,
      bloque_raison,
      date_echeance,
      updated_at,
      assigned_user:users!taches_assigned_to_fkey (nom, prenom)
    `)
    .eq('chantier_id', chantierId)
    .eq('organisation_id', organisationId)

  const tachesData = tachesRaw ?? []

  // ── 3. Récupérer les photos du jour ──────────────────────────────────────
  // Mapping explicite — chemins et URLs de stockage absents du SELECT (TST-K5-04)
  // La table photos n'a pas de colonne chantier_id : filtrage via tache_ids (FK tache_id)
  const tacheIds = tachesData.map((t) => t.id as string)

  let photosData: Array<{ id: string; commentaire: string | null; created_at: string }> = []

  // RG-CR-008 : activité = tâche modifiée OU photo du jour.
  // Déviation #3 (DECISIONLOG) : photos liées via tache_id (pas de chantier_id sur photos).
  // photos.tache_id est NOT NULL REFERENCES taches(id) (migration 008) → une photo appartient
  // TOUJOURS à une tâche. Un chantier sans tâche a donc 0 photo par construction du schéma.
  // Le scope au chantier passe exclusivement par .in('tache_id', tacheIds) : ne JAMAIS retomber
  // sur un filtre org-only (qui remonterait les photos des autres chantiers de l'org — fuite).
  if (tacheIds.length > 0) {
    const { data: photosRaw } = await (adminClient as SupabaseClient<Database>)
      .from('photos')
      .select('id, commentaire, created_at')
      .eq('organisation_id', organisationId)
      .in('tache_id', tacheIds)
      // Filtre photos du jour : created_at >= dateCr 00:00:00 et < dateCr+1
      .gte('created_at', `${dateCr}T00:00:00.000Z`)
      .lt('created_at', `${dateCr}T23:59:59.999Z`)
      .order('created_at', { ascending: true })
    photosData = photosRaw ?? []
  }

  // ── 4. Détection activité (RG-CR-008) ────────────────────────────────────
  const tachesModifieesDuJour = tachesData.filter((t) => {
    if (!t.updated_at) return false
    return t.updated_at.startsWith(dateCr)
  })

  const has_activity = tachesModifieesDuJour.length > 0 || photosData.length > 0

  // ── 5. Construire les SignalTache ─────────────────────────────────────────
  // Priorisation : modifiées_jour > bloque > en_cours > a_faire > termine
  const tachesAvecPriorite = tachesData.map((t) => {
    const estModifiee = t.updated_at?.startsWith(dateCr) ?? false
    let priorite = 4 // termine
    if (estModifiee) priorite = 0
    else if (t.statut === 'bloque') priorite = 1
    else if (t.statut === 'en_cours') priorite = 2
    else if (t.statut === 'a_faire') priorite = 3

    return { tache: t, priorite }
  })

  tachesAvecPriorite.sort((a, b) => a.priorite - b.priorite)

  // Tronquer à MAX_TACHES (specs §8 edge case)
  const tachesTronquees = tachesAvecPriorite.slice(0, MAX_TACHES)

  const taches: SignalTache[] = tachesTronquees.map(({ tache }) => {
    // Mapping EXPLICITE champ par champ (TST-K5-03 — jamais de spread)
    // assigned_user : relation join optionnelle
    const assignedUser = tache.assigned_user as unknown as
      | { nom: string | null; prenom: string | null }
      | null
      | undefined

    const assigned_to_nom =
      assignedUser?.prenom && assignedUser?.nom
        ? `${assignedUser.prenom} ${assignedUser.nom}`.trim()
        : null

    const statut = tache.statut as SignalTache['statut']

    return {
      id: tache.id,
      titre: (tache.titre ?? '').substring(0, 200),
      statut,
      // bloque_raison uniquement si statut = bloque
      bloque_raison: statut === 'bloque' ? (tache.bloque_raison ?? null) : null,
      assigned_to_nom,
      date_echeance: tache.date_echeance ?? null,
      modifie_dans_journee: tache.updated_at?.startsWith(dateCr) ?? false,
      // Champs confidentiels structurellement absents (D-051/PO-014, D-008)
    }
  })

  // ── 6. Construire les SignalPhoto ─────────────────────────────────────────
  // Mapping EXPLICITE champ par champ — chemins de stockage absents (TST-K5-04, D-4-006)
  const photos_du_jour: SignalPhoto[] = photosData.map((p) => ({
    id: p.id,
    commentaire: p.commentaire ? p.commentaire.substring(0, 500) : null,
    // type : colonne absente de photos (non sélectionnée) — défaut 'general'
    // TODO: si la table photos gagne une colonne 'type', l'ajouter ici
    type: 'general' as const,
    uploaded_at: p.created_at,
    // Chemins et URLs de stockage : structurellement absents (D-4-006, TST-K5-04)
  }))

  // ── 7. Assembler SignauxTerrain ───────────────────────────────────────────
  const signaux: SignauxTerrain = {
    chantier_id: chantierId,
    chantier_nom: chantierRaw.nom,
    date_cr: dateCr,
    taches,
    photos_du_jour,
    budget,
    generated_at: generatedAt,
  }

  logger.debug(
    {
      chantierId,
      dateCr,
      nbTaches: taches.length,
      nbPhotos: photos_du_jour.length,
      has_activity,
    },
    'collectSignaux: signaux collectés',
  )

  return { ...signaux, has_activity }
}
