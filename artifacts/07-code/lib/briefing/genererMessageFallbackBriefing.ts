// lib/briefing/genererMessageFallbackBriefing.ts — Message déterministe sans LLM
// RG-BRIEFING-007 : message fallback si LLM KO ou trial_expired (D-7-04)
// D-7-04 : best-effort — jamais throw
// Pure TypeScript, aucun appel réseau, aucun appel LLM
// Max 2000 chars (specs §2.2 constraint)

import type { SignauxBriefingChantier } from '@/types/briefing'

/**
 * Génère un message fallback déterministe à partir des signaux briefing.
 * Utilisé quand le LLM Sonnet est KO, indisponible, ou trial_expired.
 * Jamais de throw — texte garanti non vide.
 * Max 2000 chars (tronqué si nécessaire).
 *
 * @param signaux - SignauxBriefingChantier assemblé par collecterSignaux
 */
export function genererMessageFallbackBriefing(signaux: SignauxBriefingChantier): string {
  const lignes: string[] = []

  // En-tête
  lignes.push(`Briefing Semaine ${signaux.semaine_iso}/${signaux.annee_iso} — ${signaux.chantier_nom}`)
  lignes.push('')

  // État chantier
  lignes.push('ÉTAT DU CHANTIER')
  if (signaux.budget_ratio !== null) {
    const pct = (signaux.budget_ratio * 100).toFixed(1)
    const seuil = (signaux.seuil_budget * 100).toFixed(0)
    lignes.push(`Budget consommé : ${pct}% (seuil org : ${seuil}%)`)
  } else {
    lignes.push('Budget : non défini')
  }

  if (signaux.jours_restants_fin !== null) {
    if (signaux.jours_restants_fin < 0) {
      lignes.push(`Date de fin prévue : dépassée depuis ${Math.abs(signaux.jours_restants_fin)} jours`)
    } else if (signaux.jours_restants_fin === 0) {
      lignes.push("Date de fin prévue : aujourd'hui")
    } else {
      lignes.push(`Jours restants avant fin prévue : ${signaux.jours_restants_fin} jours`)
    }
  }
  lignes.push('')

  // Dérives actives
  if (signaux.derives_actives.length > 0) {
    lignes.push(`ALERTES ACTIVES (${signaux.derives_actives.length})`)
    for (const derive of signaux.derives_actives) {
      const typeLabel = {
        budget_depasse: 'Budget dépassé',
        retard_date_fin: 'Retard sur la date de fin',
        tache_bloquee_longue: 'Tâche bloquée depuis longtemps',
        inactivite_chantier: 'Inactivité chantier',
      }[derive.type] ?? derive.type

      if (derive.signal_valeur !== null && derive.signal_unite) {
        lignes.push(`- ${typeLabel} : ${derive.signal_valeur} ${derive.signal_unite}`)
      } else {
        lignes.push(`- ${typeLabel}`)
      }
    }
    lignes.push('')
  } else {
    lignes.push('ALERTES : Aucune dérive active détectée.')
    lignes.push('')
  }

  // Jalons semaine
  if (signaux.jalons_semaine.length > 0) {
    lignes.push(`JALONS CETTE SEMAINE (${signaux.jalons_semaine.length})`)
    for (const jalon of signaux.jalons_semaine) {
      const assigneLabel = jalon.assigned_to_nom ? ` — ${jalon.assigned_to_nom}` : ''
      const joursLabel = jalon.jours_restants <= 0
        ? ' (aujourd\'hui ou dépassé)'
        : ` (dans ${jalon.jours_restants}j)`
      lignes.push(`- ${jalon.tache_titre}${assigneLabel} : ${jalon.date_echeance}${joursLabel}`)
    }
    lignes.push('')
  } else {
    lignes.push('JALONS : Aucun jalon cette semaine.')
    lignes.push('')
  }

  // Météo
  if (signaux.meteo.source === 'indisponible') {
    lignes.push('MÉTÉO : Données météo indisponibles ce matin.')
  } else {
    const alertes = signaux.meteo.jours.flatMap((j) => {
      const a: string[] = []
      if (j.alerte_pluie) a.push(`pluie (${j.precipitation_mm}mm) le ${j.date_iso}`)
      if (j.alerte_gel) a.push(`gel (${j.temp_min_c}°C) le ${j.date_iso}`)
      if (j.alerte_canicule) a.push(`canicule (${j.temp_max_c}°C) le ${j.date_iso}`)
      if (j.alerte_vent) a.push(`vent fort (${j.vent_kmh.toFixed(0)}km/h) le ${j.date_iso}`)
      return a
    })

    if (alertes.length > 0) {
      lignes.push(`MÉTÉO : ${alertes.length} alerte(s) BTP cette semaine — ${alertes.slice(0, 3).join(', ')}${alertes.length > 3 ? '...' : ''}`)
    } else {
      lignes.push('MÉTÉO : Conditions favorables prévues cette semaine.')
    }
  }

  // Assembler et tronquer à 2000 chars (specs §2.2)
  const texte = lignes.join('\n')
  if (texte.length <= 2000) {
    return texte
  }

  // Troncature propre (sur une ligne entière)
  return texte.substring(0, 1997) + '...'
}
