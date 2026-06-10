// lib/reporting/isoWeek.ts — Calcul déterministe semaine ISO 8601
// Pas de dépendance à la locale serveur ni à date-fns
// Utilisé par les handlers cron et les endpoints rapports-hebdo

// ============================================================
// Calcul numéro de semaine ISO 8601
// ============================================================

/**
 * Retourne le numéro de semaine ISO (1-53) d'une date.
 * ISO 8601 : la semaine commence le lundi.
 * La semaine 1 est celle qui contient le premier jeudi de l'année.
 */
export function getIsoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7 // lundi=1, dimanche=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Retourne l'année ISO d'une date.
 * L'année ISO peut différer de l'année calendaire pour les jours
 * en début/fin d'année qui appartiennent à la semaine d'une autre année.
 */
export function getIsoYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  return d.getUTCFullYear()
}

// ============================================================
// Bornes lundi → dimanche d'une semaine ISO
// ============================================================

/**
 * Retourne les bornes (lundi, dimanche) d'une semaine ISO donnée.
 * Format retourné : YYYY-MM-DD
 *
 * Algorithme :
 *  - Trouver le 4 janvier de l'année ISO (toujours dans la semaine 1)
 *  - Calculer le lundi de la semaine 1
 *  - Décaler de (semaine - 1) semaines
 */
export function getWeekBounds(
  annee: number,
  semaine: number,
): { lundi: string; dimanche: string } {
  // Le 4 janvier est toujours dans la semaine 1 (par définition ISO 8601)
  const jan4 = new Date(Date.UTC(annee, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7 // lundi=1, dimanche=7

  // Lundi de la semaine 1
  const lundi1 = new Date(jan4)
  lundi1.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1))

  // Lundi de la semaine cible
  const lundiCible = new Date(lundi1)
  lundiCible.setUTCDate(lundi1.getUTCDate() + (semaine - 1) * 7)

  // Dimanche = lundi + 6
  const dimancheCible = new Date(lundiCible)
  dimancheCible.setUTCDate(lundiCible.getUTCDate() + 6)

  return {
    lundi: toDateString(lundiCible),
    dimanche: toDateString(dimancheCible),
  }
}

// ============================================================
// Semaine précédente
// ============================================================

/**
 * Retourne l'année ISO et la semaine ISO précédant la date donnée.
 * Utilisé par le cron lundi matin pour générer le rapport de la semaine passée (RG-RH-002).
 */
export function getPreviousIsoWeek(date: Date): { anneeIso: number; semaineIso: number } {
  // Reculer d'une semaine
  const previousWeek = new Date(date)
  previousWeek.setUTCDate(date.getUTCDate() - 7)

  return {
    anneeIso: getIsoYear(previousWeek),
    semaineIso: getIsoWeek(previousWeek),
  }
}

// ============================================================
// Helpers internes
// ============================================================

function toDateString(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Formate un label de semaine lisible.
 * Ex: "Semaine 24 — 8 au 14 juin 2026"
 */
export function formatSemaineLabel(
  anneeIso: number,
  semaineIso: number,
  locale = 'fr-FR',
): string {
  const { lundi, dimanche } = getWeekBounds(anneeIso, semaineIso)
  const [lA, lM, lD] = lundi.split('-').map(Number) as [number, number, number]
  const [dA, dM, dD] = dimanche.split('-').map(Number) as [number, number, number]

  const lundiDate = new Date(Date.UTC(lA, lM - 1, lD))
  const dimancheDate = new Date(Date.UTC(dA, dM - 1, dD))

  const fmtDay = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' })
  const fmtDayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  // Ex: "8 au 14 juin 2026" ou "30 juin au 6 juillet 2026" (mois différents)
  if (lM === dM) {
    return `Semaine ${semaineIso} — ${fmtDay.format(lundiDate)} au ${fmtDayMonth.format(dimancheDate)}`
  }

  const fmtDayMonthShort = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  return `Semaine ${semaineIso} — ${fmtDayMonthShort.format(lundiDate)} au ${fmtDayMonth.format(dimancheDate)}`
}
