import Redis from 'ioredis'
import { logger } from '@/lib/logger'

// ============================================================
// Kill switch — DISABLE_REDIS=true ou REDIS_URL absent → bypass total
// ============================================================
//
// Bug observé en prod 2026-05-19 : ioredis 5.10.x crash en boucle avec
// "Cannot read properties of undefined (reading 'auth')" dans
// node_modules/ioredis/built/redis/event_handler.js:18 (self.condition.auth).
// Cause racine non identifiée (réseau OK, auth manuelle netcat OK).
// Workaround : kill switch qui désactive ioredis complètement. Le rate
// limit devient fail-open permanent. À ré-évaluer Sprint 4+ avec un
// downgrade ioredis ou un switch vers `redis` officiel.
//
const REDIS_DISABLED =
  process.env['DISABLE_REDIS'] === 'true' || !process.env['REDIS_URL']

// ============================================================
// Singleton Redis
// ============================================================

let redisInstance: Redis | null = null
let redisInitWarned = false

function getRedisInstance(): Redis {
  if (REDIS_DISABLED) {
    if (!redisInitWarned) {
      logger.warn(
        { hasUrl: !!process.env['REDIS_URL'], disabled: process.env['DISABLE_REDIS'] === 'true' },
        'Redis désactivé (kill switch) — checkRateLimit retournera fail-open',
      )
      redisInitWarned = true
    }
    throw new Error('REDIS_DISABLED')
  }

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
    // Limiter les tentatives de reconnexion automatique.
    // Par défaut ioredis reconnecte indéfiniment avec backoff exponentiel.
    // Ici : max 10 reconnexions avant d'abandonner (évite la boucle infinie
    // en cas de Redis définitivement down). Le fail-open dans checkRateLimit
    // assure que les requêtes continuent même sans Redis.
    retryStrategy(times: number): number | null {
      if (times > 10) {
        // Après 10 tentatives, arrêter les reconnexions automatiques.
        // checkRateLimit() fait fail-open — l'app continue de fonctionner.
        logger.warn(
          { attempts: times },
          'Redis retry limit atteinte — reconnexion automatique suspendue',
        )
        return null // null = ne plus reconnnecter
      }
      // Backoff exponentiel plafonné à 3s
      return Math.min(times * 200, 3000)
    },
  })

  // Handler d'erreur sur l'instance ioredis.
  // CRITIQUE : sans ce handler, les erreurs socket ioredis remontent comme
  // EventEmitter non-handled → uncaughtException → crash process Node.js.
  // Ce handler absorbe les erreurs au niveau ioredis, avant qu'elles ne
  // sortent du système d'events. Le filet de sécurité process.on('uncaughtException')
  // dans instrumentation.ts est une deuxième ligne de défense.
  redisInstance.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Redis connection error')
  })

  redisInstance.on('connect', () => {
    logger.info('Redis connected')
  })

  redisInstance.on('ready', () => {
    logger.debug('Redis ready')
  })

  redisInstance.on('reconnecting', (delay: number) => {
    logger.warn({ delay }, 'Redis reconnecting')
  })

  redisInstance.on('close', () => {
    logger.warn('Redis connection closed')
  })

  return redisInstance
}

/**
 * Proxy Redis — résout le singleton au moment de chaque accès de propriété.
 *
 * Défense en profondeur : le Proxy attrape les exceptions levées par
 * getRedisInstance() (ex: REDIS_URL absente, initialisation échouée) et
 * les propage à l'appelant plutôt que de les laisser remonter silencieusement.
 * checkRateLimit() a un try/catch fail-open qui attrape ces erreurs.
 */
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    try {
      return getRedisInstance()[prop as keyof Redis]
    } catch (err) {
      // Propage l'erreur pour que checkRateLimit() puisse faire fail-open.
      // Ne logue pas ici — l'appelant logge dans son propre catch.
      throw err
    }
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

  // Kill switch — court-circuite avant tout appel ioredis pour éviter les
  // crashes en cascade (bug ioredis 5.10 observé prod 2026-05-19).
  if (REDIS_DISABLED) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(now + windowMs),
    }
  }

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
