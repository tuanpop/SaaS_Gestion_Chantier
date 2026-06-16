// lib/briefing/fetchMeteo.ts — Récupération météo OpenWeather avec cache DB
// D-7-12 AMENDÉ (Zoro sprint-7 F001) : OPENWEATHER_API_KEY server-only, check lazy + WARNING au boot.
//   La clé est OPTIONNELLE (météo best-effort D-7-07) : l'app démarre sans elle.
//   Un warning module-level est émis UNE FOIS au démarrage si la clé est absente (alerter l'opérateur).
//   Jamais throw au niveau module (incompatible next build + incohérent avec D-7-07 best-effort).
// RG-METEO-001 : OpenWeather One Call 3.0 + Geocoding ZIP
// RG-METEO-003 : cache meteo_cache TTL 6h par code_postal (D-7-06)
// RG-METEO-004 : OPENWEATHER_API_KEY server-only, clé optionnelle avec warning au boot
// TST-K7-09 : code_postal re-validé ^\d{5}$ défensivement avant construction URL (SSRF)
// TST-K7-08 : URL avec appid= JAMAIS loggée — logger code_postal + statusCode uniquement
// TST-K7-11 : cache corrompu (JSON invalide) → catch → re-fetch API
// AUDIT: grep NEXT_PUBLIC_OPENWEATHER = 0 à vérifier avant deploy (Risque 6 plan — Zoro grep statique)

import { analyserMeteo } from './analyserMeteo'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { MeteoSemaine } from '@/types/briefing'

// ============================================================
// Startup warning — OPENWEATHER_API_KEY optionnelle (D-7-12 amendé / D-7-07)
// Émis UNE FOIS au chargement du module si la clé est absente.
// L'app démarre normalement : météo best-effort → source='indisponible' sans la clé.
// L'opérateur est alerté immédiatement au démarrage (visible dans les logs de boot).
// ============================================================

if (!process.env['OPENWEATHER_API_KEY']) {
  logger.warn(
    'OPENWEATHER_API_KEY absente — briefing fonctionnera sans météo (fallback best-effort D-7-07). ' +
    'Ajouter la variable dans .env.local (dev) et Dokploy Environment (prod). ' +
    'JAMAIS NEXT_PUBLIC_OPENWEATHER_API_KEY.',
  )
}

// ============================================================
// Accès à la clé — uniquement au moment de l'appel API (lazy)
// Retourne null si absente → fetchMeteo retourne source='indisponible'
// ============================================================

function getOpenWeatherApiKey(): string | null {
  return process.env['OPENWEATHER_API_KEY'] ?? null
}

// Constantes API (D-7-12 : hosts constants en dur — jamais dérivés d'une entrée)
const GEOCODING_BASE_URL = 'https://api.openweathermap.org/geo/1.0/zip'
const ONECALL_BASE_URL = 'https://api.openweathermap.org/data/3.0/onecall'

// TTL cache 6h (D-7-06 / RG-METEO-003)
const CACHE_TTL_HOURS = 6

// Timeout 5s (D-7-12)
const FETCH_TIMEOUT_MS = 5_000

// ============================================================
// Validation code_postal défensive (TST-K7-09 SSRF)
// ============================================================

const CODE_POSTAL_REGEX = /^\d{5}$/

function validerCodePostal(cp: string): boolean {
  return CODE_POSTAL_REGEX.test(cp)
}

// ============================================================
// Fetch avec timeout AbortController
// ============================================================

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================
// Types internes cache DB
// ============================================================

interface MeteoCacheRow {
  id: string
  code_postal: string
  latitude: number | null
  longitude: number | null
  data: unknown
  fetched_at: string
}

// ============================================================
// Lecture cache meteo_cache
// ============================================================

async function lireCache(
  adminClient: ReturnType<typeof createAdminClient>,
  codePostal: string,
): Promise<MeteoCacheRow | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient as unknown as any)
    .from('meteo_cache')
    .select('id, code_postal, latitude, longitude, data, fetched_at')
    .eq('code_postal', codePostal)
    .gt('fetched_at', cutoff)
    .maybeSingle() as { data: MeteoCacheRow | null; error: { message: string } | null }

  if (error) {
    logger.warn(
      { codePostal, err: error.message },
      'fetchMeteo: erreur lecture meteo_cache',
    )
    return null
  }

  return data
}

// ============================================================
// Écriture/mise à jour cache meteo_cache
// ============================================================

async function ecrireCache(
  adminClient: ReturnType<typeof createAdminClient>,
  codePostal: string,
  latitude: number,
  longitude: number,
  data: unknown,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminClient as unknown as any)
      .from('meteo_cache')
      .upsert(
        {
          code_postal: codePostal,
          latitude,
          longitude,
          data,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'code_postal' },
      ) as { error: { message: string } | null }

    if (error) {
      logger.warn(
        { codePostal, err: error.message },
        'fetchMeteo: erreur écriture meteo_cache (best-effort)',
      )
    }
  } catch (err) {
    logger.warn(
      { codePostal, err: err instanceof Error ? err.message : String(err) },
      'fetchMeteo: exception écriture meteo_cache (best-effort)',
    )
  }
}

// ============================================================
// Geocoding ZIP → (lat, lon)
// TST-K7-09 : URL construite avec code_postal pré-validé uniquement
// TST-K7-08 : appid= jamais loggé
// ============================================================

interface GeocodingResult {
  lat: number
  lon: number
}

async function geocoderCodePostal(codePostal: string): Promise<GeocodingResult | null> {
  // TST-K7-09 : code_postal déjà validé par l'appelant — défense supplémentaire
  if (!validerCodePostal(codePostal)) {
    logger.warn({ codePostal }, 'fetchMeteo: code_postal invalide (geocoding ignoré)')
    return null
  }

  // Clé absente → best-effort indisponible (D-7-07 / D-7-12 amendé)
  const key = getOpenWeatherApiKey()
  if (!key) {
    logger.warn({ codePostal }, 'fetchMeteo: OPENWEATHER_API_KEY absente — geocoding ignoré (best-effort)')
    return null
  }
  // TST-K7-08 : URL avec appid= jamais loggée
  const url = `${GEOCODING_BASE_URL}?zip=${encodeURIComponent(codePostal)},FR&appid=${key}`

  try {
    const response = await fetchWithTimeout(url)

    // Logger code_postal + statusCode UNIQUEMENT — jamais l'URL avec appid= (TST-K7-08)
    if (!response.ok) {
      logger.warn(
        { codePostal, statusCode: response.status },
        'fetchMeteo: geocoding KO',
      )
      return null
    }

    const json = await response.json() as { lat?: number; lon?: number }

    if (typeof json.lat !== 'number' || typeof json.lon !== 'number') {
      logger.warn(
        { codePostal },
        'fetchMeteo: geocoding réponse invalide (lat/lon manquants)',
      )
      return null
    }

    return { lat: json.lat, lon: json.lon }
  } catch (err) {
    // Log tronqué 500 chars — sans URL ni appid (TST-K7-08)
    const errMsg = (err instanceof Error ? err.message : String(err)).substring(0, 500)
    logger.warn(
      { codePostal, err: errMsg },
      'fetchMeteo: geocoding exception (best-effort)',
    )
    return null
  }
}

// ============================================================
// One Call 3.0 — prévisions 7 jours
// TST-K7-08 : appid= jamais loggé
// ============================================================

async function fetchOneCall(lat: number, lon: number, codePostal: string): Promise<unknown | null> {
  // Clé absente → best-effort indisponible (D-7-07 / D-7-12 amendé)
  const key = getOpenWeatherApiKey()
  if (!key) {
    logger.warn({ codePostal }, 'fetchMeteo: OPENWEATHER_API_KEY absente — One Call ignoré (best-effort)')
    return null
  }
  // TST-K7-08 : URL avec appid= jamais loggée
  const url = `${ONECALL_BASE_URL}?lat=${lat}&lon=${lon}&exclude=current,minutely,hourly,alerts&units=metric&lang=fr&appid=${key}`

  try {
    const response = await fetchWithTimeout(url)

    // Logger code_postal + statusCode UNIQUEMENT — jamais l'URL avec appid= (TST-K7-08)
    if (!response.ok) {
      logger.warn(
        { codePostal, statusCode: response.status },
        'fetchMeteo: One Call KO',
      )
      return null
    }

    const json: unknown = await response.json()
    return json
  } catch (err) {
    // Log tronqué 500 chars — sans URL ni appid (TST-K7-08)
    const errMsg = (err instanceof Error ? err.message : String(err)).substring(0, 500)
    logger.warn(
      { codePostal, err: errMsg },
      'fetchMeteo: One Call exception (best-effort)',
    )
    return null
  }
}

// ============================================================
// fetchMeteo — point d'entrée principal
// Best-effort (D-7-07) : toute erreur → MeteoSemaine source='indisponible'
// Ne throw jamais le cron (RG-METEO-008)
// ============================================================

/**
 * Récupère les prévisions météo 7 jours pour un code postal.
 * Lit le cache meteo_cache avant tout appel API (TTL 6h — D-7-06).
 * Best-effort : toute erreur → source='indisponible' (D-7-07 / RG-METEO-008).
 * Ne throw jamais — le cron continue sans météo.
 *
 * @param codePostal - Code postal chantier (validé ^\d{5}$ côté DB)
 * @param adminClient - Client Supabase service_role (lecture/écriture meteo_cache)
 */
export async function fetchMeteo(
  codePostal: string,
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<MeteoSemaine> {
  const indisponible: MeteoSemaine = {
    code_postal: codePostal,
    jours: [],
    source: 'indisponible',
    fetched_at: null,
  }

  // Validation défensive code_postal ^\d{5}$ (TST-K7-09 SSRF defense-in-depth)
  // Même si le CHECK SQL garantit le format en DB, on re-valide ici par sécurité
  if (!validerCodePostal(codePostal)) {
    logger.warn({ codePostal }, 'fetchMeteo: code_postal invalide — météo indisponible')
    return indisponible
  }

  try {
    // Étape 1 : lire le cache (RG-METEO-003)
    const cachedRow = await lireCache(adminClient, codePostal)

    if (cachedRow !== null) {
      // Cache hit — tenter de parser les données (TST-K7-11 : cache corrompu → re-fetch)
      try {
        const meteo = analyserMeteo(cachedRow.data, codePostal, cachedRow.fetched_at, 'cache')
        logger.debug({ codePostal }, 'fetchMeteo: cache hit (< 6h)')
        return meteo
      } catch (parseErr) {
        // Cache corrompu — log + re-fetch API (edge 807)
        logger.warn(
          { codePostal, err: parseErr instanceof Error ? parseErr.message : String(parseErr) },
          'fetchMeteo: cache corrompu — re-fetch API',
        )
        // Continuer vers le fetch API ci-dessous
      }
    }

    // Étape 2 : geocoding si coordonnées pas en cache ou cache expiré
    let lat: number
    let lon: number

    // Si le cache existe mais expiré, réutiliser les coordonnées (évite re-geocoding — D-7-06)
    if (cachedRow !== null && cachedRow.latitude !== null && cachedRow.longitude !== null) {
      lat = cachedRow.latitude
      lon = cachedRow.longitude
      logger.debug({ codePostal }, 'fetchMeteo: coordonnées réutilisées depuis cache expiré')
    } else {
      // Cache miss — geocoder le code postal
      logger.debug({ codePostal }, 'fetchMeteo: cache miss — geocoding')
      const coords = await geocoderCodePostal(codePostal)
      if (!coords) {
        logger.warn({ codePostal }, 'fetchMeteo: geocoding échoué — météo indisponible')
        return indisponible
      }
      lat = coords.lat
      lon = coords.lon
    }

    // Étape 3 : One Call 3.0
    logger.debug({ codePostal }, 'fetchMeteo: appel One Call 3.0')
    const rawData = await fetchOneCall(lat, lon, codePostal)

    if (!rawData) {
      return indisponible
    }

    // Étape 4 : analyser + normaliser
    let meteo: MeteoSemaine
    try {
      const now = new Date().toISOString()
      meteo = analyserMeteo(rawData, codePostal, now, 'api')
    } catch (parseErr) {
      // Réponse API malformée — log tronqué sans URL (TST-K7-08)
      const errMsg = (parseErr instanceof Error ? parseErr.message : String(parseErr)).substring(0, 500)
      logger.warn(
        { codePostal, err: errMsg },
        'fetchMeteo: réponse One Call invalide — météo indisponible',
      )
      return indisponible
    }

    // Étape 5 : mettre en cache (best-effort — D-7-06)
    await ecrireCache(adminClient, codePostal, lat, lon, rawData)

    logger.info({ codePostal }, 'fetchMeteo: météo récupérée et mise en cache')
    return meteo
  } catch (err) {
    // Erreur inattendue — log + fallback indisponible (D-7-07)
    const errMsg = (err instanceof Error ? err.message : String(err)).substring(0, 500)
    logger.warn(
      { codePostal, err: errMsg },
      'fetchMeteo: erreur inattendue — météo indisponible (best-effort)',
    )
    return indisponible
  }
}
