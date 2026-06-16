// types/detection.ts — types autoritatifs Sprint 6 IA Dérive
// D-008 BINDING : la détection est déterministe. Ces types décrivent les signaux calculés
// AVANT tout appel LLM. Le LLM reçoit un SignauxDeriveChantier typé et retourne un string.
// PO-6-02=B : SeuilsEffectifs charge depuis seuils_derives (fallback défaut si absent).
// PO-6-05=B : 1 appel LLM par chantier, prompt agrégé pour tous les SignalDerive[].
//
// Sécurité :
//   EXI-Y-K6-02 / D-051 / TST-K6-02 : SignalDeriveTacheBloquee N'A PAS de champ
//     note_privee_conducteur — protection structurelle au niveau du TYPE.
//   TST-K6-12 : DeriveDetectee exclut notification_id et organisation_id — surface réduite.

export type DeriveType =
  | 'budget_depasse'       // budget_depense / budget_alloue > seuilsEffectifs.ratio_budget
  | 'retard_date_fin'      // date_fin_prevue < today AND statut = 'actif'
  | 'tache_bloquee_longue' // tâche statut='bloque' depuis > seuilsEffectifs.jours_blocage
  | 'inactivite_chantier'  // aucune activité depuis > seuilsEffectifs.jours_inactivite

// ---------------------------------------------------------------
// Seuils effectifs pour une organisation (PO-6-02=B)
// Lus depuis seuils_derives, avec fallback sur les valeurs par défaut.
// ---------------------------------------------------------------

export interface SeuilsEffectifs {
  organisation_id: string
  ratio_budget: number        // ex: 0.85
  jours_blocage: number       // ex: 3
  jours_inactivite: number    // ex: 7
  source: 'db' | 'defaut'     // 'db' = ligne trouvée dans seuils_derives ; 'defaut' = fallback
}

// Valeurs par défaut (constantes TypeScript — fallback si aucune ligne seuils_derives pour l'org)
// Sans organisation_id ni source : ces champs sont portés par SeuilsEffectifs.
export const SEUILS_DEFAUT: Omit<SeuilsEffectifs, 'organisation_id' | 'source'> = {
  ratio_budget: 0.85,
  jours_blocage: 3,
  jours_inactivite: 7,
} as const

// ---------------------------------------------------------------
// Signaux bruts de dérive (calculés de façon déterministe)
// D-008 BINDING : ces structures sont le résultat de fonctions TypeScript pures.
// Le LLM ne reçoit que ces structures — il ne calcule rien.
// ---------------------------------------------------------------

export interface SignalDeriveBudget {
  type: 'budget_depasse'
  budget_alloue: number
  budget_depense: number
  ratio: number           // budget_depense / budget_alloue, ex: 0.92
  depassement_eur: number // budget_depense - budget_alloue, en EUR
  seuil_applique: number  // ratio_budget effectif utilisé (pour le prompt LLM)
}

export interface SignalDeriveRetard {
  type: 'retard_date_fin'
  date_fin_prevue: string // ISO date YYYY-MM-DD
  jours_retard: number    // Math.floor((today - date_fin_prevue) / 86400000)
}

// EXI-Y-K6-02 / D-051 / TST-K6-02 BINDING :
// Ce type ne contient STRUCTURELLEMENT PAS de champ note_privee_conducteur.
// La protection est au niveau du TYPE, pas dans une consigne LLM.
// Mapping explicite champ par champ dans detecterDerivesTacheBloquee — jamais select('*').
export interface SignalDeriveTacheBloquee {
  type: 'tache_bloquee_longue'
  tache_id: string
  tache_titre: string  // max 200 chars — JAMAIS note_privee_conducteur (D-051 BINDING)
  jours_bloque: number // depuis le dernier updated_at en statut bloqué
  seuil_applique: number  // jours_blocage effectif utilisé (pour le prompt LLM)
}

export interface SignalDeriveInactivite {
  type: 'inactivite_chantier'
  jours_sans_activite: number  // depuis le dernier updated_at tâche OU photo
  derniere_activite: string | null  // ISO date, null si jamais d'activité
  seuil_applique: number  // jours_inactivite effectif utilisé (pour le prompt LLM)
}

export type SignalDerive =
  | SignalDeriveBudget
  | SignalDeriveRetard
  | SignalDeriveTacheBloquee
  | SignalDeriveInactivite

// ---------------------------------------------------------------
// Agrégat des dérives d'un chantier pour un passage cron (PO-6-05=B)
// C'est L'UNIQUE ENTRÉE du LLM — aucun champ secret ne doit y entrer (EXI-Y-K6-02).
// Un seul SignauxDeriveChantier par appel LLM = isolation cross-org garantie (TST-K6-03).
// ---------------------------------------------------------------

export interface SignauxDeriveChantier {
  chantier_id: string
  chantier_nom: string         // max 200 chars — JAMAIS note_privee_conducteur
  organisation_id: string
  seuils: SeuilsEffectifs      // seuils effectifs utilisés pour ce chantier
  evaluated_at: string         // ISO timestamp du passage cron
  derives: SignalDerive[]      // liste des dérives actives détectées (peut être vide)
}

// ---------------------------------------------------------------
// Résultat du cron pour un chantier
// ---------------------------------------------------------------

export interface ResultatDetectionChantier {
  chantier_id: string
  derives_nouvelles: DeriveType[]
  derives_resolues: DeriveType[]
  derives_deja_actives: DeriveType[]
  message_llm: string | null          // null si LLM KO ou aucune dérive nouvelle
  notification_inseree: boolean
  erreur: string | null
}

// ---------------------------------------------------------------
// Réponse globale du handler cron
// ---------------------------------------------------------------

export interface ReponseCronDerive {
  chantiers_evalues: number
  chantiers_avec_derive: number
  chantiers_sans_derive: number
  chantiers_skipped_archive: number
  derives_nouvelles_total: number
  derives_resolues_total: number
  llm_appels: number
  llm_erreurs: number
  erreurs: string[]
}

// ---------------------------------------------------------------
// Payload configuration des seuils (API PATCH)
// FIX F002 2026-06-16 : borne inférieure ratio_budget = 0.50 (EXI-Y-K6-07 Kakashi)
// ---------------------------------------------------------------

export interface PatchSeuilsDerivesBody {
  ratio_budget?: number      // 0.50 <= x < 1 (borne sécurité EXI-Y-K6-07 — anti-DoS économique LLM)
  jours_blocage?: number     // integer >= 1
  jours_inactivite?: number  // integer >= 1
}

// ---------------------------------------------------------------
// Réponse GET seuils (avec source)
// ---------------------------------------------------------------

export interface SeuilsDerivesResponse {
  organisation_id: string
  ratio_budget: number
  jours_blocage: number
  jours_inactivite: number
  source: 'db' | 'defaut'
  updated_at: string | null
}

// ---------------------------------------------------------------
// Forme retournée par GET /api/chantiers/[id]/derives (surface réduite)
// TST-K6-12 : exclut notification_id et organisation_id — surface réduite côté client.
// ---------------------------------------------------------------

export interface DeriveDetectee {
  id: string
  chantier_id: string
  // organisation_id EXCLU (TST-K6-12 — inutile côté client)
  type: DeriveType
  tache_id: string | null
  signal_valeur: number | null
  signal_unite: 'ratio' | 'jours' | 'jours_sans_activite' | null
  message_llm: string | null
  detected_at: string
  resolved_at: string | null
  // notification_id EXCLU (TST-K6-12 — inutile côté client)
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------
// Forme retournée par GET /api/derives (vue consolidée admin)
// Inclut chantier_nom (JOIN)
// ---------------------------------------------------------------

export interface DeriveConsolidee extends DeriveDetectee {
  chantier_nom: string
}

// ---------------------------------------------------------------
// Réponses paginées
// ---------------------------------------------------------------

export interface DerivesChantierResponse {
  derives: DeriveDetectee[]
  next_cursor: string | null  // ISO timestamp detected_at du dernier item, null si fin
}

export interface DerivesConsolideeResponse {
  derives: DeriveConsolidee[]
  total_actives: number
  next_cursor: string | null
}
