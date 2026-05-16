import Redis from 'ioredis'
import { logger } from '@/lib/logger'

// ============================================================
// Singleton Redis
// ============================================================

let redisInstance: Redis | null = null

function getRedisInstance(): Redis {
  if (redisInstance) {
    return redisInstance
  }

  const redisUrl = process.env['REDIS_URL']
  if (!redisUrl) {
    throw new Error('REDIS_URL est requis pour la connexion Redis.')
  }

  redisInstance = new Redis(redisUrl, {
    // Pas de retry infini — fail rapide pour ne pas bloquer les requêtes
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    // Timeout de connexion
    connectTimeout: 5000,
    lazyConnect: true,
  })

  redisInstance.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Redis connection error')
  })

  redisInstance.on('connect', () => {
    logger.info('Redis connected')
  })

  redisInstance.on('ready', () => {
    logger.debug('Redis ready')
  })

  return redisInstance
}

export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return getRedisInstance()[prop as keyof Redis]
  },
})

// ============================================================
// Rate limiting — Sliding window (atomique via Lua script)
// Décision consciente : fail-open si Redis indisponible
// (disponibilité > sécurité en cas de panne Redis partielle)
// ============================================================

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export interface RateLimitOptions {
  /** Clé Redis, ex: `rate:login:${ip}` */
  key: string
  /** Nombre maximum de requêtes dans la fenêtre */
  limit: number
  /** Durée de la fenêtre en millisecondes */
  windowMs: number
}

/**
 * Sliding window rate limiter via Redis MULTI/EXEC.
 * Atomique — pas de race condition entre les requêtes.
 *
 * Fail-open : si Redis est indisponible, la requête est autorisée
 * et l'incident est loggé. (architecture.md §Risques identifiés)
 */
export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowMs } = opts
  const now = Date.now()
  const windowStart = now - windowMs
  const windowSec = Math.ceil(windowMs / 1000)

  try {
    const instance = getRedisInstance()

    // Sliding window via ZADD + ZREMRANGEBYSCORE + ZCARD + EXPIRE
    // Atomique via pipeline (MULTI/EXEC implicite avec pipeline)
    const pipeline = instance.pipeline()

    // Ajouter le timestamp de la requête actuelle comme score
    pipeline.zadd(key, now, `${now}-${Math.random()}`)
    // Supprimer les entrées hors de la fenêtre
    pipeline.zremrangebyscore(key, 0, windowStart)
    // Compter les requêtes dans la fenêtre
    pipeline.zcard(key)
    // Expire la clé après la fenêtre pour éviter les fuites mémoire
    pipeline.expire(key, windowSec)

    const results = await pipeline.exec()

    // results[2] = résultat de ZCARD = nombre de requêtes actuelles
    const countResult = results?.[2]
    const currentCount = countResult?.[1] as number ?? 0

    const allowed = currentCount <= limit
    const remaining = Math.max(0, limit - currentCount)
    const resetAt = new Date(now + windowMs)

    if (!allowed) {
      logger.warn(
        { key, currentCount, limit, windowMs },
        'Rate limit exceeded',
      )
    }

    return { allowed, remaining, resetAt }
  } catch (err) {
    // Fail-open : Redis indisponible -> autoriser la requête mais logger
    logger.error(
      { err: err instanceof Error ? err.message : String(err), key },
      'Redis unavailable — rate limit check failed-open (request allowed)',
    )
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(now + windowMs),
    }
  }
}

// ============================================================
// Limites prédéfinies Sprint 1 (specs.md §Rate limiting)
// ============================================================

export const RATE_LIMITS = {
  /** POST /api/organisations — 10 req/h/IP */
  signup: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** POST /api/auth/login — 5 req/15min/IP */
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  /** POST /api/auth/magic-link — 5 req/15min/IP */
  magicLink: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const
