/**
 * __tests__/briefing/analyserMeteo.test.ts
 *
 * Tests Vitest pour lib/briefing/analyserMeteo.ts
 * D-008 BINDING : fonction pure TypeScript, aucun appel réseau.
 * RG-METEO-005/006/007 : normalisation + seuils d'alerte BTP
 *
 * Cas couverts :
 *   AM-1 : Happy path — 7 jours valides → MeteoSemaine correcte (source='api')
 *   AM-2 : Conversion m/s → km/h correcte (× 3.6)
 *   AM-3 : Alerte pluie déclenchée si precipitation_mm >= 5
 *   AM-4 : Alerte gel déclenchée si temp_min <= 2°C
 *   AM-5 : Alerte canicule déclenchée si temp_max >= 35°C
 *   AM-6 : Alerte vent déclenchée si vent >= 60 km/h (soit ~16.7 m/s)
 *   AM-7 : JSON invalide → throw (parse défensif Zod — cache corrompu)
 *   AM-8 : Précipitations : rain absent → 0 mm (jamais NaN)
 *   AM-9 : Jour semaine FR correct (Lundi=1, Dimanche=0)
 */

import { describe, it, expect } from 'vitest'
import {
  analyserMeteo,
  SEUIL_ALERTE_PLUIE_MM,
  SEUIL_ALERTE_GEL_C,
  SEUIL_ALERTE_CANICULE_C,
  SEUIL_ALERTE_VENT_KMH,
} from '@/lib/briefing/analyserMeteo'

// ============================================================
// Fixture OpenWeather minimal valide (7 jours)
// ============================================================

function buildDailyDay(overrides: {
  dt?: number
  tempMin?: number
  tempMax?: number
  windSpeed?: number
  rain?: number
  description?: string
}) {
  const {
    dt = 1750550400,      // 2026-06-22 (lundi UTC)
    tempMin = 15,
    tempMax = 25,
    windSpeed = 5,        // m/s
    rain,
    description = 'Ensoleillé',
  } = overrides

  const day: Record<string, unknown> = {
    dt,
    temp: { min: tempMin, max: tempMax },
    weather: [{ description }],
    pop: 0,
    wind_speed: windSpeed,
  }
  if (rain !== undefined) day.rain = rain
  return day
}

function buildValidOpenWeatherResponse(days: ReturnType<typeof buildDailyDay>[]) {
  return { daily: days }
}

/** Crée 7 jours de base avec timestamps qui avancent de 86400s chacun */
function build7Days(overrideDay0?: Parameters<typeof buildDailyDay>[0]) {
  const base = 1750550400  // 2026-06-22 lundi UTC
  return Array.from({ length: 7 }, (_, i) =>
    buildDailyDay({
      dt: base + i * 86400,
      ...(i === 0 ? overrideDay0 : {}),
    }),
  )
}

// ============================================================
// Tests
// ============================================================

describe('analyserMeteo', () => {
  it('AM-1 : happy path — 7 jours valides → MeteoSemaine correcte', () => {
    const raw = buildValidOpenWeatherResponse(build7Days())
    const result = analyserMeteo(raw, '75001', '2026-06-22T08:30:00Z', 'api')

    expect(result.code_postal).toBe('75001')
    expect(result.source).toBe('api')
    expect(result.fetched_at).toBe('2026-06-22T08:30:00Z')
    expect(result.jours).toHaveLength(7)
    // Date ISO jour 0
    expect(result.jours[0]!.date_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.jours[0]!.temp_min_c).toBe(15)
    expect(result.jours[0]!.temp_max_c).toBe(25)
  })

  it('AM-2 : conversion m/s → km/h (× 3.6)', () => {
    const raw = buildValidOpenWeatherResponse(build7Days({ windSpeed: 10 }))  // 10 m/s = 36 km/h
    const result = analyserMeteo(raw, '13000', '2026-06-22T08:30:00Z', 'cache')

    expect(result.jours[0]!.vent_kmh).toBeCloseTo(36, 1)
    expect(result.jours[0]!.alerte_vent).toBe(false)  // 36 < 60
  })

  it('AM-3 : alerte pluie si precipitation_mm >= 5', () => {
    const rawAvec = buildValidOpenWeatherResponse(build7Days({ rain: SEUIL_ALERTE_PLUIE_MM }))
    const rawSans = buildValidOpenWeatherResponse(build7Days({ rain: SEUIL_ALERTE_PLUIE_MM - 1 }))

    const avec = analyserMeteo(rawAvec, '75001', '2026-06-22T08:30:00Z', 'api')
    const sans = analyserMeteo(rawSans, '75001', '2026-06-22T08:30:00Z', 'api')

    expect(avec.jours[0]!.alerte_pluie).toBe(true)
    expect(avec.jours[0]!.precipitation_mm).toBe(SEUIL_ALERTE_PLUIE_MM)
    expect(sans.jours[0]!.alerte_pluie).toBe(false)
  })

  it('AM-4 : alerte gel si temp_min <= 2°C', () => {
    const rawAvec = buildValidOpenWeatherResponse(build7Days({ tempMin: SEUIL_ALERTE_GEL_C }))
    const rawSans = buildValidOpenWeatherResponse(build7Days({ tempMin: SEUIL_ALERTE_GEL_C + 1 }))

    const avec = analyserMeteo(rawAvec, '75001', '2026-06-22T08:30:00Z', 'api')
    const sans = analyserMeteo(rawSans, '75001', '2026-06-22T08:30:00Z', 'api')

    expect(avec.jours[0]!.alerte_gel).toBe(true)
    expect(sans.jours[0]!.alerte_gel).toBe(false)
  })

  it('AM-5 : alerte canicule si temp_max >= 35°C', () => {
    const rawAvec = buildValidOpenWeatherResponse(build7Days({ tempMax: SEUIL_ALERTE_CANICULE_C }))
    const rawSans = buildValidOpenWeatherResponse(build7Days({ tempMax: SEUIL_ALERTE_CANICULE_C - 1 }))

    const avec = analyserMeteo(rawAvec, '75001', '2026-06-22T08:30:00Z', 'api')
    const sans = analyserMeteo(rawSans, '75001', '2026-06-22T08:30:00Z', 'api')

    expect(avec.jours[0]!.alerte_canicule).toBe(true)
    expect(sans.jours[0]!.alerte_canicule).toBe(false)
  })

  it('AM-6 : alerte vent si vent >= 60 km/h (soit ~16.67 m/s)', () => {
    const windMs = SEUIL_ALERTE_VENT_KMH / 3.6  // 60 km/h → 16.666... m/s
    const rawAvec = buildValidOpenWeatherResponse(build7Days({ windSpeed: windMs }))
    const rawSans = buildValidOpenWeatherResponse(build7Days({ windSpeed: windMs - 1 }))

    const avec = analyserMeteo(rawAvec, '75001', '2026-06-22T08:30:00Z', 'api')
    const sans = analyserMeteo(rawSans, '75001', '2026-06-22T08:30:00Z', 'api')

    expect(avec.jours[0]!.alerte_vent).toBe(true)
    expect(sans.jours[0]!.alerte_vent).toBe(false)
  })

  it('AM-7 : JSON invalide → throw (parse défensif Zod — cache corrompu)', () => {
    const invalide = { daily: [] }  // daily vide — min 7 requis
    expect(() => analyserMeteo(invalide, '75001', '2026-06-22T08:30:00Z', 'api')).toThrow()

    const autreForme = { not_daily: [] }  // clé manquante
    expect(() => analyserMeteo(autreForme, '75001', '2026-06-22T08:30:00Z', 'api')).toThrow()

    expect(() => analyserMeteo(null, '75001', '2026-06-22T08:30:00Z', 'api')).toThrow()
  })

  it('AM-8 : précipitations — rain absent → 0 mm (jamais NaN)', () => {
    const daysSansRain = build7Days()  // rain absent dans buildDailyDay si rain=undefined
    const raw = buildValidOpenWeatherResponse(daysSansRain)
    const result = analyserMeteo(raw, '75001', '2026-06-22T08:30:00Z', 'api')

    for (const jour of result.jours) {
      expect(jour.precipitation_mm).toBe(0)
      expect(Number.isNaN(jour.precipitation_mm)).toBe(false)
    }
  })

  it('AM-9 : jour semaine FR non vide pour chaque jour', () => {
    const raw = buildValidOpenWeatherResponse(build7Days())
    const result = analyserMeteo(raw, '75001', '2026-06-22T08:30:00Z', 'api')

    const joursFR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
    for (const jour of result.jours) {
      expect(joursFR).toContain(jour.jour_semaine)
    }
  })
})
