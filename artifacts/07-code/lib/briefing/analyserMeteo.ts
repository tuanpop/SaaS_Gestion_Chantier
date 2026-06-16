// lib/briefing/analyserMeteo.ts — Transforme la réponse brute OpenWeather en MeteoSemaine
// D-008 BINDING : fonction pure TypeScript, aucun appel réseau.
// RG-METEO-005 : normalise temp °C, precipitation mm, vent km/h (converti depuis m/s × 3.6)
// RG-METEO-006 : seuils d'alerte BTP (constantes exportées)
// RG-METEO-007 : utilise daily[0..6] (7 jours)
// Parse défensif Zod de la réponse brute (TST-K7-11 — cache corrompu → throw → caller re-fetch)

import { z } from 'zod'
import type { MeteoJour, MeteoSemaine } from '@/types/briefing'

// ============================================================
// Seuils d'alerte BTP — constantes exportées (RG-METEO-006)
// ============================================================

/** Précipitations >= 5 mm/jour → alerte pluie (risque arrêt coulage béton) */
export const SEUIL_ALERTE_PLUIE_MM = 5

/** Température minimale <= 2°C → alerte gel (risque chutes/dommages matériaux) */
export const SEUIL_ALERTE_GEL_C = 2

/** Température maximale >= 35°C → alerte canicule (obligations légales) */
export const SEUIL_ALERTE_CANICULE_C = 35

/** Vent >= 60 km/h → alerte vent (travaux en hauteur) */
export const SEUIL_ALERTE_VENT_KMH = 60

// ============================================================
// Schéma Zod défensif pour la réponse OpenWeather brute
// Parse défensif : JSON invalide/incomplet → throw (le caller gère best-effort)
// ============================================================

const OpenWeatherDailySchema = z.object({
  dt: z.number().int(),             // Unix timestamp
  temp: z.object({
    min: z.number(),
    max: z.number(),
  }),
  weather: z.array(z.object({
    description: z.string().default(''),
  })).min(1),
  pop: z.number().min(0).max(1).default(0),  // probability of precipitation [0,1]
  rain: z.number().optional(),               // rain volume mm (certaines réponses l'omettent)
  wind_speed: z.number().default(0),         // m/s
})

const OpenWeatherResponseSchema = z.object({
  daily: z.array(OpenWeatherDailySchema).min(7),
})

type OpenWeatherResponse = z.infer<typeof OpenWeatherResponseSchema>

// ============================================================
// Mapping Unix timestamp → YYYY-MM-DD et jour semaine FR
// ============================================================

const JOURS_SEMAINE_FR = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
]

function unixToDateIso(dt: number): string {
  const date = new Date(dt * 1000)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function unixToJourSemaine(dt: number): string {
  const date = new Date(dt * 1000)
  return JOURS_SEMAINE_FR[date.getUTCDay()] ?? 'Inconnu'
}

// ============================================================
// Calcul précipitations
// OpenWeather One Call 3.0 : rain = volume mm du jour, sinon estimer depuis pop
// On prend rain si disponible, sinon 0 (pop est une probabilité, pas un volume)
// ============================================================

function calculerPrecipitationMm(daily: z.infer<typeof OpenWeatherDailySchema>): number {
  if (daily.rain !== undefined && daily.rain > 0) {
    return daily.rain
  }
  // pop = probability [0,1] — pas une quantité, on retourne 0 si rain absent
  return 0
}

// ============================================================
// analyserMeteo — transformation principale
// Retourne MeteoSemaine à partir du JSONB stocké dans meteo_cache.data
// Throw si la structure est invalide (caller doit gérer : source='indisponible' + re-fetch)
// ============================================================

/**
 * Transforme la réponse brute OpenWeather (jsonb) en MeteoSemaine normalisée.
 * Parse défensif Zod : si la structure est invalide, throw une Error.
 * Le caller (fetchMeteo) doit catcher et traiter comme cache corrompu → re-fetch.
 *
 * @param rawData - Object JSON parsé depuis meteo_cache.data
 * @param codePostal - Code postal du chantier
 * @param fetchedAt - ISO timestamp de la dernière récupération
 * @param source - 'api' | 'cache'
 */
export function analyserMeteo(
  rawData: unknown,
  codePostal: string,
  fetchedAt: string,
  source: 'api' | 'cache',
): MeteoSemaine {
  // Parse défensif Zod (TST-K7-11)
  const parsed = OpenWeatherResponseSchema.safeParse(rawData)
  if (!parsed.success) {
    throw new Error(
      `analyserMeteo: structure OpenWeather invalide — ${parsed.error.message.substring(0, 200)}`,
    )
  }

  const data: OpenWeatherResponse = parsed.data

  // Utilise daily[0..6] (7 jours — RG-METEO-007)
  const jours: MeteoJour[] = data.daily.slice(0, 7).map((daily) => {
    const precipitationMm = calculerPrecipitationMm(daily)
    const ventKmh = daily.wind_speed * 3.6  // conversion m/s → km/h

    // Description du premier élément weather (traduit FR via param lang=fr de l'API)
    const description = daily.weather[0]?.description ?? ''

    return {
      date_iso: unixToDateIso(daily.dt),
      jour_semaine: unixToJourSemaine(daily.dt),
      temp_min_c: daily.temp.min,
      temp_max_c: daily.temp.max,
      description,
      precipitation_mm: precipitationMm,
      vent_kmh: ventKmh,
      // Flags BTP (seuils RG-METEO-006)
      alerte_pluie: precipitationMm >= SEUIL_ALERTE_PLUIE_MM,
      alerte_gel: daily.temp.min <= SEUIL_ALERTE_GEL_C,
      alerte_canicule: daily.temp.max >= SEUIL_ALERTE_CANICULE_C,
      alerte_vent: ventKmh >= SEUIL_ALERTE_VENT_KMH,
    }
  })

  return {
    code_postal: codePostal,
    jours,
    source,
    fetched_at: fetchedAt,
  }
}
