// types/reporting.ts — types autoritatifs Sprint 5 Reporting
// Source : specs-sprint-5.md §2.4 + llm-design.md §3
// NE PAS modifier sans mise à jour de DECISIONLOG.md

// ============================================================
// Signaux terrain (collecte déterministe D-008)
// ============================================================

export interface SignalTache {
  id: string
  titre: string                                         // max 200 chars
  statut: 'a_faire' | 'en_cours' | 'termine' | 'bloque'
  bloque_raison: string | null                          // jamais inclus si statut != bloque
  assigned_to_nom: string | null                        // prénom + nom, jamais user_id
  date_echeance: string | null                          // ISO date
  modifie_dans_journee: boolean                         // true si updated_at = date_cr
  // Champs confidentiels exclus structurellement (D-051/PO-014, D-008)
}

export interface SignalPhoto {
  id: string
  commentaire: string | null                            // max 500 chars
  type: 'avant' | 'apres' | 'general'
  uploaded_at: string                                   // ISO timestamp
  // Chemins de stockage exclus structurellement (D-4-006, TST-K5-04)
}

export interface SignalBudget {
  alloue: number | null
  depense: number | null
  ecart: number | null                                  // depense - alloue, null si l'un des deux est null
  couleur: 'vert' | 'orange' | 'rouge'                 // calculerCouleur() — déterministe D-008
}

export interface SignauxTerrain {
  chantier_id: string
  chantier_nom: string
  date_cr: string                                       // ISO date YYYY-MM-DD
  taches: SignalTache[]                                 // toutes les tâches du chantier
  photos_du_jour: SignalPhoto[]                         // photos uploadées le jour date_cr
  budget: SignalBudget
  generated_at: string                                  // ISO timestamp de la collecte
}

// ============================================================
// CR journalier
// ============================================================

export type StatutCR = 'brouillon' | 'valide' | 'envoye'

export interface CompteRendu {
  id: string
  organisation_id: string
  chantier_id: string
  date_cr: string                                       // YYYY-MM-DD
  donnees_brutes: SignauxTerrain | null
  contenu_genere: string | null
  statut: StatutCR
  valide_par: string | null                             // user_id
  valide_at: string | null                              // ISO timestamp
  envoye_par: string | null
  envoye_at: string | null
  envoye_a: string | null                               // emails internes snapshot, jamais email externe client
  declenche_par: 'cron' | 'manuel'
  created_at: string
  updated_at: string
}

// Version compacte pour la liste (sans contenu_genere et donnees_brutes — specs §6.3)
export interface CompteRenduListe {
  id: string
  chantier_id: string
  organisation_id: string
  date_cr: string
  statut: StatutCR
  declenche_par: 'cron' | 'manuel'
  valide_par: string | null
  valide_at: string | null
  envoye_at: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Rapport hebdo
// ============================================================

export type StatutRapportHebdo = 'brouillon' | 'valide' | 'envoye'

export interface RapportHebdo {
  id: string
  organisation_id: string
  chantier_id: string
  annee_iso: number
  semaine_iso: number
  cr_ids: string[]
  contenu_genere: string | null
  statut: StatutRapportHebdo
  valide_par: string | null
  valide_at: string | null
  envoye_par: string | null
  envoye_at: string | null
  envoye_a: string | null                               // emails internes snapshot (PO-5-04)
  created_at: string
  updated_at: string
}

// Version compacte pour la liste (sans contenu_genere)
export interface RapportHebdoListe {
  id: string
  chantier_id: string
  organisation_id: string
  annee_iso: number
  semaine_iso: number
  cr_ids: string[]
  statut: StatutRapportHebdo
  valide_par: string | null
  valide_at: string | null
  envoye_at: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Input LLM (llm-design.md §3)
// ============================================================

// Résumé d'un CR pour l'agrégation hebdo
export interface CrResume {
  date_cr: string
  contenu_genere: string
}

// Input pour la génération du rapport hebdo
export interface HebdoInput {
  chantierId: string
  chantierNom: string
  anneeIso: number
  semaineIso: number
  lundiDate: string     // YYYY-MM-DD
  dimancheDate: string  // YYYY-MM-DD
  crs: CrResume[]       // CRs validés de la semaine (statut IN valide/envoye)
  budgetFinSemaine: SignalBudget
}
