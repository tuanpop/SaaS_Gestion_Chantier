// lib/cache.ts
// Cache memoire process Node — remplace Redis pour rate-limiting et trial-gate (D-054)
//
// Limitation V1 documentee (D-054) :
//   - Reset au restart container (rate-limit pas persistant)
//   - Perd la coherence cross-instance si > 1 replica app
//   Trigger V2 (retour Redis) : > 1 instance app concurrente OU > 10k checks/jour
//
// Design :
//   - Stores nommes (Map<storeName, Map<key, entry>>) pour isolation logique par usage
//   - Eviction lazy au read : pas de setInterval, pas de GC actif
//   - Rate-limit : timestamps en tableau avec fenetre glissante (pas de ZADD atomique,
//     mais acceptable pour V1 single-instance)

// ============================================================
// Cache generique get/set/del + TTL
// ============================================================

type CacheEntry<T> = { value: T; expiresAt: number }

// Map<storeName, Map<key, entry>>
const stores = new Map<string, Map<string, CacheEntry<unknown>>>()

function getStore(name: string): Map<string, CacheEntry<unknown>> {
  let s = stores.get(name)
  if (!s) {
    s = new Map()
    stores.set(name, s)
  }
  return s
}

/** Retourne la valeur si non expiree, null sinon (eviction lazy). */
export function cacheGet<T>(storeName: string, key: string): T | null {
  const store = getStore(storeName)
  const entry = store.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    store.delete(key)
    return null
  }
  return entry.value as T
}

/** Stocke la valeur avec TTL en millisecondes. */
export function cacheSet<T>(storeName: string, key: string, value: T, ttlMs: number): void {
  const store = getStore(storeName)
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/** Supprime une entree. */
export function cacheDel(storeName: string, key: string): void {
  const store = getStore(storeName)
  store.delete(key)
}

// ============================================================
// Rate limiting — Sliding window (remplace Redis Lua script)
// ============================================================
//
// Comportement : pour chaque hit, on log le timestamp, on supprime ceux
// hors fenetre, on compte. Si count <= limit, la requete est autorisee.
//
// Fail-open preservé : le rate-limit est une defense en profondeur,
// pas un garde critique (coherent avec l'ancien comportement Redis).

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export interface RateLimitOptions {
  /** Cle unique, ex: `rate:login:${ip}` */
  key: string
  /** Nombre maximum de requetes dans la fenetre */
  limit: number
  /** Duree de la fenetre en millisecondes */
  windowMs: number
}

// Map globale pour les timestamps de rate-limit (separee du cache generique)
const rateLimitTimestamps = new Map<string, number[]>()

/**
 * Sliding window rate limiter en memoire.
 * Synchrone — pas de Promise (contrairement a l'ancienne version Redis).
 * Les callers qui avaient un await superflu peuvent le conserver sans effet.
 */
export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs } = opts
  const now = Date.now()
  const windowStart = now - windowMs

  const arr = rateLimitTimestamps.get(key) ?? []
  // Filtrer les timestamps hors fenetre (eviction lazy)
  const inWindow = arr.filter(t => t >= windowStart)
  inWindow.push(now)
  rateLimitTimestamps.set(key, inWindow)

  const currentCount = inWindow.length
  const allowed = currentCount <= limit
  const remaining = Math.max(0, limit - currentCount)
  const resetAt = new Date(now + windowMs)

  return { allowed, remaining, resetAt }
}

// ============================================================
// Limites predefinies Sprint 1 (identiques aux constantes Redis legacy)
// Ref : specs.md Rate limiting
// ============================================================

export const RATE_LIMITS = {
  /** POST /api/organisations — 10 req/h/IP */
  signup: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** POST /api/auth/login — 5 req/15min/IP */
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  /** POST /api/auth/magic-link — 5 req/15min/IP */
  magicLink: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const
