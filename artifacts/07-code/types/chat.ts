// types/chat.ts — Types autoritatifs Sprint 8
// ADR-013 BINDING : 4 types d'action.
// ADR-007 étendu BINDING : validation humaine obligatoire avant tout execute.
// D-051 BINDING : note_privee_conducteur absent de tout contexte LLM.
// D-8-14 BINDING : PayloadX ne portent QUE des valeurs métier, jamais chantier_id/organisation_id.
// EXI-Y-K8-04 : note_privee_conducteur absent structurellement de tout contexte LLM.
// EXI-Y-K8-06 : PayloadX Zod strict rejette toute clé non déclarée.

// ---------------------------------------------------------------
// Types de base
// ---------------------------------------------------------------

export type MessageType = 'user' | 'bot' | 'system'
export type ActionType = 'creer_tache' | 'ajouter_cr' | 'replanifier' | 'alerte'
export type ActionProposalStatut = 'pending' | 'valide' | 'rejete' | 'execute'

// ---------------------------------------------------------------
// Message dans le chat
// ---------------------------------------------------------------

export interface MessageChat {
  id: string
  chat_id: string
  chantier_id: string
  auteur_id: string | null          // null pour type=system
  auteur_nom: string | null          // prénom + nom résolu, null pour system
  auteur_role: 'admin' | 'conducteur' | 'ouvrier' | null
  type: MessageType
  contenu: string                    // max 4000 chars — JAMAIS note_privee_conducteur
  deleted_at: string | null          // null = pas supprimé
  action_proposal_id: string | null  // lien vers proposition
  created_at: string
}

// ---------------------------------------------------------------
// Payloads des propositions d'action (validés par Zod côté handler)
// BINDING D-8-14 : ces types ne portent JAMAIS chantier_id/organisation_id
// L'isolation vient de action_proposals (figés serveur à la création par le pipeline)
// ---------------------------------------------------------------

// Type 1 : créer une tâche
// NE PAS inclure : note_privee_conducteur (D-051 BINDING)
// NE PAS inclure : chantier_id / organisation_id (D-8-14 BINDING)
export interface PayloadCreerTache {
  titre: string            // max 200 chars — obligatoire
  description?: string     // max 500 chars — optionnel
  assigned_to?: string     // user_id — optionnel
  date_echeance?: string   // YYYY-MM-DD — optionnel
}

// Type 2 : ajouter un élément au CR journalier du jour
// Le handler résout le CR brouillon du jour pour ce chantier_id (depuis action_proposals)
export interface PayloadAjouterCR {
  note: string             // texte à ajouter aux signaux du CR, max 500 chars
}

// Type 3 : replanifier une date
// ressource_id désigne une tâche ou un chantier — JAMAIS un chantier hors périmètre
// L'exécution filtre TOUJOURS par chantier_id = proposal.chantier_id (D-8-14)
// F004 fix : ressource_id nullable — cas tâche non identifiable par Sonnet (RG-ACTION-006)
// Quand null, executerAction retourne une erreur métier claire (conducteur sélectionne manuellement)
export interface PayloadReplanifier {
  cible: 'tache' | 'chantier'
  ressource_id: string | null  // tache_id ou chantier_id ; null si non identifiable par le LLM
  nouvelle_date: string        // YYYY-MM-DD
  raison?: string              // max 200 chars — optionnel
}

// Type 4 : émettre une alerte
// Résolution des users via resolveDestinatairesInternes ou subset
// Jamais d'ouvrier (PO-4V-03 BINDING)
export interface PayloadAlerte {
  titre: string            // max 150 chars — sujet de l'alerte
  message: string          // max 500 chars — corps de l'alerte
  destinataires: 'admins' | 'conducteurs' | 'tous'
}

export type ActionPayload =
  | PayloadCreerTache
  | PayloadAjouterCR
  | PayloadReplanifier
  | PayloadAlerte

// ---------------------------------------------------------------
// Proposition d'action (vue API)
// ---------------------------------------------------------------

export interface ActionProposal {
  id: string
  organisation_id: string  // figé serveur — source d'autorité pour l'exécution (D-8-14)
  chantier_id: string      // figé serveur — source d'autorité pour l'exécution (D-8-14)
  message_id: string
  type: ActionType
  payload: ActionPayload   // JSONB éditable par le conducteur
  statut: ActionProposalStatut
  valide_par: string | null
  valide_at: string | null
  erreur_execution: string | null
  ressource_id: string | null
  ressource_type: 'tache' | 'chantier' | 'notification' | 'compte_rendu' | null
  created_at: string
}

// ---------------------------------------------------------------
// Résultat du pipeline Haiku → Sonnet
// ---------------------------------------------------------------

// Union discriminée stricte — JSON Haiku invalide → {type:'neutre'} (fallback safe)
export type IntentionBot =
  | { type: 'neutre' }                                              // Aucun appel Sonnet
  | { type: 'claw_inline'; question: string }                       // Message @claw détecté
  | { type: 'action_a_proposer'; action_type: ActionType }          // Action détectée

export interface ResultatPipelineBot {
  message_id: string
  intention: IntentionBot
  haiku_tokens: number     // tokens Haiku utilisés (monitoring coût)
  sonnet_tokens: number    // tokens Sonnet utilisés (0 si intention=neutre)
  proposition_creee: boolean
  reponse_inline: string | null  // contenu du message bot @claw
  erreur: string | null
}

// ---------------------------------------------------------------
// Accueil Claw (Feature #9)
// ---------------------------------------------------------------

export interface ContenuAccueilClaw {
  message_principal: string  // ex: "Bonjour Mohamed ! Voici ta journée :"
  taches_du_jour: Array<{
    titre: string              // max 200 chars — JAMAIS note_privee_conducteur (D-051)
    statut: string
    date_echeance: string | null
  }>
  meteo_resume: string | null  // ex: "Soleil, 22°C. Pas de contrainte météo." — null si indisponible
  meteo_disponible: boolean
}

// ---------------------------------------------------------------
// Contexte bot (retourné par construireContexteBot)
// Structurellement sans note_privee_conducteur (EXI-Y-K8-04 / D-051)
// ---------------------------------------------------------------

export interface MembreContexte {
  id: string
  nom: string
  prenom: string
  role: string
}

export interface TacheContexte {
  id: string
  titre: string            // JAMAIS note_privee_conducteur ici
  statut: string
  date_echeance: string | null
  assigned_to: string | null
}

export interface DeriveContexte {
  id: string
  type_derive: string
  description: string
  statut: string
}

// Contexte fourni au pipeline bot — sans note_privee_conducteur (D-051 BINDING)
// Mapping champ par champ — jamais select('*') ni spread (EXI-Y-K8-04)
export interface ContexteBot {
  chantier: {
    id: string
    nom: string
    statut: string
    date_debut: string | null
    date_fin_prevue: string | null
  }
  taches: TacheContexte[]          // Sans note_privee_conducteur (D-051)
  membres: MembreContexte[]
  derives_actives: DeriveContexte[] // Vide pour ouvrier (RG-CLAW-006)
  role_appelant: 'admin' | 'conducteur' | 'ouvrier'
}
