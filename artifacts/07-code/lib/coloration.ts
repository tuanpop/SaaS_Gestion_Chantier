// lib/coloration.ts
// Logique DÉTERMINISTE (ADR-008, D-007, D-008) — aucun LLM
// Source : specs.md §4 — règles de coloration portefeuille
// Testable sans DB : fonction pure, entrées scalaires uniquement.

import type { CouleurChantier } from '@/types/database'

// ============================================================
// Types
// ============================================================

export type { CouleurChantier }

export interface ChantierColoration {
  date_fin_prevue: string       // YYYY-MM-DD
  budget_alloue: number | null  // Q5 (2026-05-15) : nullable
  budget_depense: number
}

// ============================================================
// calculerCouleur — règles EXACTES de specs.md §4 (aucune interprétation)
// ============================================================
//
// Rouge  -> date_fin_prevue < aujourd_hui (date dépassée)
//           OU (budget_alloue != null ET budget_depense > budget_alloue)
// Orange -> date_fin_prevue - aujourd_hui <= 3 jours ET date_fin_prevue >= aujourd_hui
// Vert   -> tout le reste
//
// Note budget_alloue null : traité comme "pas de dérive budget calculable" = vert sur axe budget
// (documenté dans SPRINT_2_PLAN.md §Note technique + tests scénario 5)

export function calculerCouleur(
  chantier: ChantierColoration,
  aujourdhui: Date,
): CouleurChantier {
  // Normaliser les dates en YYYY-MM-DD pour une comparaison de chaînes fiable
  // Évite les problèmes de timezone (date locale vs UTC)
  const finPrevue = chantier.date_fin_prevue // déjà YYYY-MM-DD
  const dateStr = toDateString(aujourdhui)

  // Vérification rouge — date dépassée
  if (finPrevue < dateStr) {
    return 'rouge'
  }

  // Vérification rouge — dépassement budget
  if (
    chantier.budget_alloue !== null &&
    chantier.budget_depense > chantier.budget_alloue
  ) {
    return 'rouge'
  }

  // Vérification orange — date_fin_prevue dans les 3 prochains jours (inclus aujourd'hui)
  // finPrevue >= dateStr (pas encore dépassé) && finPrevue - aujourd_hui <= 3 jours
  const diffJours = dateDiffJours(aujourdhui, finPrevue)
  if (diffJours <= 3 && diffJours >= 0) {
    return 'orange'
  }

  // Vert — tout le reste
  return 'vert'
}

// ============================================================
// trierParCouleur — tri rouge > orange > vert (specs.md §Tri obligatoire)
// Stable sort (preserve l'ordre relatif des éléments de même couleur)
// ============================================================

const COULEUR_PRIORITY: Record<CouleurChantier, number> = {
  rouge: 0,
  orange: 1,
  vert: 2,
}

export function trierParCouleur<T extends { couleur: CouleurChantier }>(
  chantiers: T[],
): T[] {
  // Copie pour ne pas muter l'original
  return [...chantiers].sort(
    (a, b) => COULEUR_PRIORITY[a.couleur] - COULEUR_PRIORITY[b.couleur],
  )
}

// ============================================================
// Helpers internes
// ============================================================

/**
 * Convertit une Date en string YYYY-MM-DD (fuseau local)
 * Utilisé pour éviter les décalages timezone sur les comparaisons de dates
 */
function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Calcule la différence en jours entre aujourd'hui et une date cible YYYY-MM-DD.
 * Retourne un nombre positif si la date cible est dans le futur, 0 si aujourd'hui, négatif si passé.
 * Utilisé pour la logique "orange si date_fin_prevue dans les 3 prochains jours".
 */
function dateDiffJours(depuis: Date, versDateStr: string): number {
  // Parser YYYY-MM-DD comme date locale (sans composante temps)
  const [year, month, day] = versDateStr.split('-').map(Number)
  const cible = new Date(year!, month! - 1, day!)

  // Normaliser depuis à minuit local pour une comparaison propre
  const depuisNormalise = new Date(
    depuis.getFullYear(),
    depuis.getMonth(),
    depuis.getDate(),
  )

  const msParJour = 1000 * 60 * 60 * 24
  return Math.round((cible.getTime() - depuisNormalise.getTime()) / msParJour)
}
