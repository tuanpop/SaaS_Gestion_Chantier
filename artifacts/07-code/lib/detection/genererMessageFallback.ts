// lib/detection/genererMessageFallback.ts — Message déterministe multi-dérive sans LLM
// D-6-03 : si le LLM est KO, ce fallback est utilisé pour la notification.
// RG-DERIVE-010 : le cron ne bloque jamais sur un échec LLM — ce fallback garantit
//   qu'une notification est toujours insérée avec un message lisible.
//
// Sortie tronquée à 1000 chars (RG-DERIVE-015 — message notif max 1000 chars).
// Retourne un string non vide pour toute combinaison de types de dérive.

import type { SignauxDeriveChantier, SignalDerive } from '@/types/detection'

// ============================================================
// Formatters par type (1 variante lisible par type)
// ============================================================

function formatSignal(signal: SignalDerive): string {
  switch (signal.type) {
    case 'budget_depasse': {
      const pct = Math.round(signal.ratio * 100)
      const seuil = Math.round(signal.seuil_applique * 100)
      const depass = Math.round(signal.depassement_eur)
      return `Budget dépassé : ${pct}% du budget consommé (seuil : ${seuil}%). Dépassement estimé : ${depass} €.`
    }
    case 'retard_date_fin': {
      const j = signal.jours_retard
      return `Retard : date de fin prévue dépassée depuis ${j} jour${j > 1 ? 's' : ''} (${signal.date_fin_prevue}).`
    }
    case 'tache_bloquee_longue': {
      const j = signal.jours_bloque
      const seuil = signal.seuil_applique
      return `Tâche bloquée : « ${signal.tache_titre} » bloquée depuis ${j} jour${j > 1 ? 's' : ''} (seuil : ${seuil}j).`
    }
    case 'inactivite_chantier': {
      const j = signal.jours_sans_activite
      const seuil = signal.seuil_applique
      const depuis = signal.derniere_activite ? ` (dernière activité : ${signal.derniere_activite})` : ''
      return `Inactivité : aucune activité depuis ${j} jour${j > 1 ? 's' : ''} (seuil : ${seuil}j)${depuis}.`
    }
  }
}

// ============================================================
// genererMessageFallback — entrée principale
// ============================================================

/**
 * Génère un message déterministe multi-dérive sans appel LLM.
 * Utilisé quand le LLM est KO (D-6-03) ou quand l'org est trial_expired (D-6-12).
 *
 * @param signaux - SignauxDeriveChantier avec au moins 1 dérive
 * @returns string non vide, tronqué à 1000 chars
 */
export function genererMessageFallback(signaux: SignauxDeriveChantier): string {
  const { derives, chantier_nom } = signaux

  if (derives.length === 0) {
    // Cas défensif : jamais appelé avec 0 dérive en pratique (D-6-04 : LLM appelé si ≥1 nouvelle)
    return `Chantier « ${chantier_nom} » : aucune dérive détectée.`
  }

  const lignes: string[] = []

  if (derives.length === 1) {
    lignes.push(formatSignal(derives[0]!))
  } else {
    lignes.push(`${derives.length} alertes détectées sur le chantier « ${chantier_nom } » :`)
    for (const signal of derives) {
      lignes.push(`• ${formatSignal(signal)}`)
    }
  }

  const message = lignes.join('\n')

  // RG-DERIVE-015 : tronqué à 1000 chars avant retour
  return message.slice(0, 1000)
}
