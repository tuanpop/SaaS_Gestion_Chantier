// types/briefing.ts — types autoritatifs Sprint 7 Briefing automatique
// D-008 BINDING : la collecte des signaux est déterministe.
// Le LLM Sonnet reçoit un SignauxBriefingChantier typé et retourne un texte.
// note_privee_conducteur structurellement absent (D-051 BINDING).
// Recopie exacte specs §2.4 — ne pas dériver sans DECISIONLOG.

// ---------------------------------------------------------------
// Météo OpenWeather — données pertinentes BTP
// ---------------------------------------------------------------

export interface MeteoJour {
  date_iso: string           // YYYY-MM-DD (converti depuis dt Unix timestamp)
  jour_semaine: string       // ex: "Lundi", "Mardi" (pour contexte LLM)
  temp_min_c: number         // température minimale en °C
  temp_max_c: number         // température maximale en °C
  description: string        // ex: "Pluie modérée", "Ensoleillé" (traduit FR)
                             // SECURITE : source tierce non fiable → escapeDelimiter avant prompt (D-7-13 / TST-K7-02)
  precipitation_mm: number   // cumul précipitations mm (0 si absent)
  vent_kmh: number           // vitesse vent km/h (converti depuis m/s × 3.6)
  // Flags impact BTP (calculés par lib/briefing/analyserMeteo.ts — seuils RG-METEO-006)
  alerte_pluie: boolean      // precipitation_mm >= 5 mm/jour
  alerte_gel: boolean        // temp_min_c <= 2°C
  alerte_canicule: boolean   // temp_max_c >= 35°C
  alerte_vent: boolean       // vent_kmh >= 60 km/h
}

export interface MeteoSemaine {
  code_postal: string
  jours: MeteoJour[]         // 7 éléments (du lundi au dimanche)
  source: 'api' | 'cache' | 'indisponible'
  fetched_at: string | null  // ISO timestamp, null si indisponible
}

// ---------------------------------------------------------------
// Jalons semaine
// SECURITE : note_privee_conducteur JAMAIS présent dans ce type (D-051 BINDING).
// Protection structurelle TypeScript — tout ajout échoue au build.
// TST-K7-03 : test obligatoire — clé absente du type.
// ---------------------------------------------------------------

export interface JalonSemaine {
  tache_id: string
  tache_titre: string        // max 200 chars — JAMAIS note_privee_conducteur (D-051)
                             // source : taches.titre (mapping champ par champ — jamais select('*'))
  date_echeance: string      // YYYY-MM-DD
  statut: string             // a_faire | en_cours | bloque
  jours_restants: number     // (date_echeance - today) en jours. 0 = aujourd'hui, négatif = dépassé
  assigned_to_nom: string | null  // prénom + nom de l'assigné (ou null si non assigné)
}

// ---------------------------------------------------------------
// Signaux dérive (réutilise types Sprint 6 — copie autonome, évite import croisé)
// ---------------------------------------------------------------

export interface DeriveActive {
  type: 'budget_depasse' | 'retard_date_fin' | 'tache_bloquee_longue' | 'inactivite_chantier'
  signal_valeur: number | null
  signal_unite: string | null
  message_llm: string | null  // message LLM Haiku Sprint 6, si disponible
  detected_at: string
}

// ---------------------------------------------------------------
// Signaux briefing — agrégat pour un chantier
// SECURITE : ce type est L'UNIQUE entrée du LLM Sonnet (D-7-05).
// Aucun champ secret (note_privee_conducteur) ne doit y entrer (EXI-Y-K6-02).
// Un seul SignauxBriefingChantier par appel (1 chantier, 1 org) — pas d'exfil cross-org (TST-K7-04).
// ---------------------------------------------------------------

export interface SignauxBriefingChantier {
  chantier_id: string
  chantier_nom: string           // max 100 chars — JAMAIS note_privee_conducteur
  organisation_id: string
  semaine_iso: number
  annee_iso: number
  generated_at: string           // ISO timestamp

  // État chantier
  statut: string                 // 'actif' (seuls les actifs sont briefés)
  budget_ratio: number | null    // budget_depense / budget_alloue, null si budget non défini
  jours_restants_fin: number | null  // date_fin_prevue - today, null si pas de date

  // Dérives actives (Sprint 6 — réutilisées, non recalculées)
  derives_actives: DeriveActive[]  // peut être vide

  // Jalons de la semaine à venir
  jalons_semaine: JalonSemaine[]   // tâches avec date_echeance dans [today, today+6]

  // Météo 7 jours
  meteo: MeteoSemaine             // source='indisponible' si appel KO

  // Contexte seuils (pour interpréter les ratios dans le prompt LLM)
  seuil_budget: number            // ratio_budget effectif de l'org (pour le contexte LLM)
}

// ---------------------------------------------------------------
// Résultat de génération pour un chantier
// ---------------------------------------------------------------

export interface ResultatBriefingChantier {
  chantier_id: string
  briefing_id: string | null      // null si INSERT échoue
  llm_utilise: boolean
  meteo_disponible: boolean
  notification_inseree: boolean
  erreur: string | null
}

// ---------------------------------------------------------------
// Réponse globale du cron (ReponseCronBriefing)
// Compteurs complets — specs §6.1
// ---------------------------------------------------------------

export interface ReponseCronBriefing {
  chantiers_evalues: number
  briefings_generes: number
  briefings_skipped_existants: number  // idempotence — déjà générés cette semaine
  // chantiers_skipped_archive retiré (Zoro F002) : le cron charge uniquement statut='actif',
  // les archivés ne sont jamais évalués donc ce compteur était structurellement toujours 0 (trompeur).
  chantiers_skipped_trial_expired: number
  llm_appels: number
  llm_erreurs: number
  meteo_appels_api: number
  meteo_hits_cache: number
  meteo_erreurs: number
  erreurs: string[]
}

// ---------------------------------------------------------------
// Contenu affiché dans le fil de notifications
// ---------------------------------------------------------------

export interface ContenuNotificationBriefing {
  // Extrait du contenu_genere ou du message_fallback
  // Max 200 chars pour le titre notif, 1000 pour le message notif
  titre: string   // ex: "Briefing semaine 26 — Rénovation Leclerc"
  message: string // résumé 1-3 phrases + mention météo si disponible
}

// ---------------------------------------------------------------
// Row briefing (lecture DB côté API)
// Champs publics retournés par GET /api/briefings et GET /api/briefings/[id]
// Exclut : donnees_brutes, meteo_snapshot, notification_ids, organisation_id (specs §6.2/§6.4)
// ---------------------------------------------------------------

export interface BriefingPublic {
  id: string
  chantier_id: string
  annee_iso: number
  semaine_iso: number
  contenu_genere: string | null
  message_fallback: string | null
  llm_utilise: boolean
  meteo_disponible: boolean
  code_postal: string | null
  created_at: string
}

/** Briefing avec nom de chantier jointé (liste admin) */
export interface BriefingAvecChantier extends BriefingPublic {
  chantier_nom: string
}

/** Briefing détail avec meteo_jours pré-calculés (PO-7 décision Option A — TST-K7 Risque 1 validé) */
export interface BriefingDetail extends BriefingPublic {
  chantier_nom: string
  meteo_jours?: MeteoJour[]   // Extrait de meteo_snapshot côté serveur (meteo_snapshot brut non exposé)
}
