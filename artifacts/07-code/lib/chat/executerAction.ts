// lib/chat/executerAction.ts — Exécution d'une proposition validée (4 types d'action)
// D-8-13 BINDING : ce fichier est appelé UNIQUEMENT par PATCH .../valider
//   Jamais par le pipeline bot (S-8-09 — audit : grep executerAction dans pipeline-bot.ts = 0)
// D-8-14 BINDING IDOR : chantier_id/organisation_id TOUJOURS lus de proposal, JAMAIS du payload
//   Toute INSERT/UPDATE porte le double filtre chantier_id = proposal.chantier_id AND organisation_id = proposal.organisation_id
// D-045 BINDING : taches n'a pas de deleted_at — jamais de filtre taches.deleted_at IS NULL
// D-4V-002 BINDING : htmlEscape délégué à insertNotification (point unique — NE PAS appliquer avant)
// PO-4V-03 BINDING : jamais d'ouvrier dans les destinataires alerte
// RG-ACTION-004→007 BINDING : logique d'exécution par type
// RG-ACTION-008 : best-effort — exécution KO → {erreur: message}, pas de rollback

import { logger } from '@/lib/logger'
import {
  insertNotification,
  resolveConducteurChantier,
  resolveAdminsOrg,
} from '@/lib/notifications/notif'
import type { ActionProposal } from '@/types/chat'
import type { createAdminClient } from '@/lib/supabase/admin'
import {
  PayloadCreerTacheSchema,
  PayloadAjouterCRSchema,
  PayloadReplanifierSchema,
  PayloadAlerteSchema,
} from '@/lib/validation/chat'

// RG-ACTION-010 / RG-BOT-008 : type notification pour les propositions d'action
// Utilisé par pipeline-bot.ts (notification US-080 à la création d'une proposition)
// et par valider/route.ts (notification de confirmation d'exécution)
export const NOTIF_TYPE_ACTION_PROPOSAL = 'action_proposal' as const

type AdminClient = ReturnType<typeof createAdminClient>

// ============================================================
// Types résultat
// ============================================================

export interface ResultatExecution {
  ressource_id: string | null
  ressource_type: 'tache' | 'chantier' | 'notification' | 'compte_rendu' | null
  erreur: string | null
}

// ============================================================
// executerAction — point d'entrée unique
// D-8-13 BINDING : appelé UNIQUEMENT depuis PATCH .../valider
// D-8-14 BINDING : chantier_id et organisation_id pris de proposal, JAMAIS du payload
// ============================================================

export async function executerAction(
  proposal: ActionProposal,
  adminClient: AdminClient,
  // Utilisateur qui valide la proposition (admin/conducteur) — devient created_by
  // de la tâche créée (taches.created_by NOT NULL). Source serveur (auth), jamais du payload.
  createdBy: string,
): Promise<ResultatExecution> {
  // D-8-14 : source d'autorité IDOR — jamais du payload
  const { chantier_id, organisation_id, type, payload } = proposal

  switch (type) {
    case 'creer_tache':
      return executerCreerTache(chantier_id, organisation_id, payload, adminClient, createdBy)
    case 'ajouter_cr':
      return executerAjouterCR(chantier_id, organisation_id, payload, adminClient)
    case 'replanifier':
      return executerReplanifier(chantier_id, organisation_id, payload, adminClient)
    case 'alerte':
      return executerAlerte(chantier_id, organisation_id, payload, adminClient)
    default: {
      const _exhaustive: never = type
      return { ressource_id: null, ressource_type: null, erreur: `Type d'action inconnu : ${String(_exhaustive)}` }
    }
  }
}

// ============================================================
// Type 1 : creer_tache (RG-ACTION-004)
// D-8-14 : chantier_id/organisation_id du proposal — jamais du payload
// D-045 : taches n'a pas de deleted_at — statut = 'a_faire' directement
// ============================================================

async function executerCreerTache(
  chantier_id: string,
  organisation_id: string,
  rawPayload: unknown,
  adminClient: AdminClient,
  createdBy: string,
): Promise<ResultatExecution> {
  // Re-valider le payload (EXI-Y-K8-06 — Zod strict)
  const parsed = PayloadCreerTacheSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Payload creer_tache invalide : ${parsed.error.message}`,
    }
  }

  const { titre, description, assigned_to, date_echeance } = parsed.data

  try {
    const insertPayload = {
      chantier_id,            // D-8-14 : du proposal, jamais du payload
      organisation_id,        // D-8-14 : du proposal, jamais du payload
      created_by: createdBy,  // taches.created_by NOT NULL — utilisateur validateur (auth)
      titre,
      description: description ?? null,
      assigned_to: assigned_to ?? null,
      date_echeance: date_echeance ?? null,
      statut: 'a_faire' as const, // D-045 : pas de deleted_at sur taches
    }

    const { data, error } = await (adminClient as unknown as AdminClient)
      .from('taches')
      .insert(insertPayload as unknown as import('@/types/database').Database['public']['Tables']['taches']['Insert'])
      .select('id')
      .single() as unknown as { data: { id: string } | null; error: { message: string } | null }

    if (error || !data) {
      logger.error(
        { chantier_id, error: error?.message },
        'executerAction creer_tache: INSERT échoué',
      )
      return {
        ressource_id: null,
        ressource_type: null,
        erreur: `Erreur création tâche : ${error?.message ?? 'Erreur inconnue'}`,
      }
    }

    logger.info({ chantier_id, tacheId: data.id }, 'executerAction creer_tache: succès')
    return {
      ressource_id: data.id,
      ressource_type: 'tache',
      erreur: null,
    }
  } catch (err) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Exception création tâche : ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ============================================================
// Type 2 : ajouter_cr (RG-ACTION-005)
// Recherche le CR brouillon du jour pour ce chantier_id (du proposal — D-8-14)
// UPDATE donnees_brutes.notes_chat[] si trouvé
// Pas de création automatique de CR (D-007 BINDING)
// ============================================================

async function executerAjouterCR(
  chantier_id: string,
  organisation_id: string,
  rawPayload: unknown,
  adminClient: AdminClient,
): Promise<ResultatExecution> {
  const parsed = PayloadAjouterCRSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Payload ajouter_cr invalide : ${parsed.error.message}`,
    }
  }

  const { note } = parsed.data
  const today = new Date().toISOString().split('T')[0]! // YYYY-MM-DD

  try {
    // Recherche CR brouillon du jour (D-8-14 : chantier_id du proposal)
    const { data: crRow, error: crError } = await (adminClient as unknown as AdminClient)
      .from('comptes_rendus')
      .select('id, donnees_brutes')
      .eq('chantier_id', chantier_id)           // D-8-14 : du proposal
      .eq('organisation_id', organisation_id)    // D-8-14 : du proposal
      .eq('date_cr', today)
      .eq('statut', 'brouillon')
      .maybeSingle() as unknown as {
        data: { id: string; donnees_brutes: Record<string, unknown> } | null
        error: { message: string } | null
      }

    if (crError) {
      return {
        ressource_id: null,
        ressource_type: null,
        erreur: `Erreur recherche CR : ${crError.message}`,
      }
    }

    if (!crRow) {
      // RG-ACTION-005 : pas de création automatique — erreur documentée
      return {
        ressource_id: null,
        ressource_type: 'compte_rendu',
        erreur: 'Aucun CR brouillon du jour — note en attente',
      }
    }

    // UPDATE donnees_brutes : ajouter la note dans notes_chat[]
    const donneesBrutes = crRow.donnees_brutes ?? {}
    const notesChatExistantes = Array.isArray(donneesBrutes['notes_chat'])
      ? (donneesBrutes['notes_chat'] as string[])
      : []
    const nouvellesDonnees = {
      ...donneesBrutes,
      notes_chat: [...notesChatExistantes, note],
    }

    const { error: updateError } = await (adminClient as unknown as AdminClient)
      .from('comptes_rendus')
      .update({ donnees_brutes: nouvellesDonnees } as unknown as import('@/types/database').Database['public']['Tables']['comptes_rendus']['Update'])
      .eq('id', crRow.id)
      .eq('chantier_id', chantier_id)           // D-8-14 : double filtre IDOR
      .eq('organisation_id', organisation_id) as unknown as {
        error: { message: string } | null
      }

    if (updateError) {
      return {
        ressource_id: null,
        ressource_type: null,
        erreur: `Erreur mise à jour CR : ${updateError.message}`,
      }
    }

    logger.info({ chantier_id, crId: crRow.id }, 'executerAction ajouter_cr: succès')
    return {
      ressource_id: crRow.id,
      ressource_type: 'compte_rendu',
      erreur: null,
    }
  } catch (err) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Exception ajouter CR : ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ============================================================
// Type 3 : replanifier (RG-ACTION-006)
// D-8-14 IDOR : UPDATE filtré par chantier_id = proposal.chantier_id
// Validation : nouvelle_date >= today (refus de replanifier dans le passé)
// ============================================================

async function executerReplanifier(
  chantier_id: string,
  organisation_id: string,
  rawPayload: unknown,
  adminClient: AdminClient,
): Promise<ResultatExecution> {
  const parsed = PayloadReplanifierSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Payload replanifier invalide : ${parsed.error.message}`,
    }
  }

  const { cible, ressource_id, nouvelle_date } = parsed.data

  // Validation : date >= aujourd'hui (RG-ACTION-006)
  const today = new Date().toISOString().split('T')[0]!
  if (nouvelle_date < today) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `La nouvelle date (${nouvelle_date}) est dans le passé — replanification refusée.`,
    }
  }

  // F004 : ressource_id nullable (aligné Yuki schema.ts l.158) — erreur métier claire si null
  // RG-ACTION-006 : tâche/chantier non identifiable → le conducteur doit sélectionner manuellement
  if (ressource_id === null) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: 'ressource_id manquant — la ressource à replanifier n\'a pas pu être identifiée automatiquement. Sélectionnez la tâche ou le chantier manuellement.',
    }
  }

  try {
    if (cible === 'tache') {
      // UPDATE taches — D-8-14 : double filtre chantier_id + organisation_id du proposal
      // D-045 : taches n'a pas de deleted_at — pas de filtre deleted_at IS NULL
      const { data: updateData, error: updateError } = await (adminClient as unknown as AdminClient)
        .from('taches')
        .update({ date_echeance: nouvelle_date })
        .eq('id', ressource_id)
        .eq('chantier_id', chantier_id)           // D-8-14 IDOR : du proposal
        .eq('organisation_id', organisation_id)    // D-8-14 IDOR : du proposal
        .select('id')
        .maybeSingle() as unknown as {
          data: { id: string } | null
          error: { message: string } | null
        }

      if (updateError) {
        return {
          ressource_id: null,
          ressource_type: null,
          erreur: `Erreur replanification tâche : ${updateError.message}`,
        }
      }

      if (!updateData) {
        return {
          ressource_id: null,
          ressource_type: null,
          erreur: `Tâche ${ressource_id} introuvable ou hors périmètre chantier — replanification impossible.`,
        }
      }

      logger.info({ chantier_id, tacheId: ressource_id, nouvelle_date }, 'executerAction replanifier tâche: succès')
      return {
        ressource_id: ressource_id,
        ressource_type: 'tache',
        erreur: null,
      }
    } else {
      // cible === 'chantier'
      // UPDATE chantiers — D-8-14 : double filtre (chantier_id = ressource_id + organisation_id)
      const { data: updateData, error: updateError } = await (adminClient as unknown as AdminClient)
        .from('chantiers')
        .update({ date_fin_prevue: nouvelle_date })
        .eq('id', ressource_id)
        .eq('organisation_id', organisation_id)    // D-8-14 IDOR : du proposal
        .select('id')
        .maybeSingle() as unknown as {
          data: { id: string } | null
          error: { message: string } | null
        }

      if (updateError) {
        return {
          ressource_id: null,
          ressource_type: null,
          erreur: `Erreur replanification chantier : ${updateError.message}`,
        }
      }

      if (!updateData) {
        return {
          ressource_id: null,
          ressource_type: null,
          erreur: `Chantier ${ressource_id} introuvable ou hors périmètre organisation — replanification impossible.`,
        }
      }

      logger.info({ chantier_id, chantierId: ressource_id, nouvelle_date }, 'executerAction replanifier chantier: succès')
      return {
        ressource_id: ressource_id,
        ressource_type: 'chantier',
        erreur: null,
      }
    }
  } catch (err) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Exception replanification : ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ============================================================
// Type 4 : alerte (RG-ACTION-007)
// D-4V-002 BINDING : htmlEscape délégué à insertNotification (point unique — D-4V-002)
//   NE PAS appliquer htmlEscape ici — insertNotification l'applique en interne.
//   Double-encodage si on l'applique avant (&amp;lt; au lieu de &lt;).
//   Conforme au pattern documenté DECISIONLOG F004 Itachi Phase 4 (cron derives) et D-4V-002.
// PO-4V-03 BINDING : jamais d'ouvrier dans les destinataires
// Résolution users via resolveAdminsOrg + resolveConducteurChantier
// ============================================================

async function executerAlerte(
  chantier_id: string,
  organisation_id: string,
  rawPayload: unknown,
  adminClient: AdminClient,
): Promise<ResultatExecution> {
  const parsed = PayloadAlerteSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Payload alerte invalide : ${parsed.error.message}`,
    }
  }

  const { titre, message, destinataires } = parsed.data

  // D-4V-002 : NE PAS appliquer htmlEscape ici — insertNotification l'applique en interne.
  // Passer les valeurs brutes à insertNotification (délégation à l'unique point d'échappement).

  try {
    // Résolution des destinataires (admins, conducteurs, ou tous) — PO-4V-03 : jamais ouvrier
    const destinataireIds: string[] = []

    if (destinataires === 'admins' || destinataires === 'tous') {
      const adminsIds = await resolveAdminsOrg(adminClient, organisation_id)
      destinataireIds.push(...adminsIds)
    }

    if (destinataires === 'conducteurs' || destinataires === 'tous') {
      const conducteurId = await resolveConducteurChantier(adminClient, chantier_id, organisation_id)
      if (conducteurId) {
        destinataireIds.push(conducteurId)
      }
    }

    // Dédoublonner (admin peut aussi être conducteur dans certains setups)
    const uniqueIds = [...new Set(destinataireIds)]

    if (uniqueIds.length === 0) {
      return {
        ressource_id: null,
        ressource_type: null,
        erreur: 'Aucun destinataire résolu pour l\'alerte.',
      }
    }

    // insertNotification pour chaque destinataire (best-effort interne)
    // D-4V-002 : insertNotification applique htmlEscape en interne — valeurs brutes passées ici
    for (const userId of uniqueIds) {
      await insertNotification({
        organisationId: organisation_id,
        userId,
        type: 'alerte_chat' as import('@/types/database').NotificationType,
        titre,    // brut — htmlEscape délégué à insertNotification (D-4V-002)
        message,  // brut — htmlEscape délégué à insertNotification (D-4V-002)
        chantierId: chantier_id,
        tacheId: null,
      })
    }

    logger.info(
      { chantier_id, destinataireCount: uniqueIds.length },
      'executerAction alerte: succès',
    )
    return {
      ressource_id: null, // Pas de ressource unique créée (N notifications)
      ressource_type: 'notification',
      erreur: null,
    }
  } catch (err) {
    return {
      ressource_id: null,
      ressource_type: null,
      erreur: `Exception alerte : ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
