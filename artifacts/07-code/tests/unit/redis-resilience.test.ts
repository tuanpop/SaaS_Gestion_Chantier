/**
 * tests/unit/redis-resilience.test.ts
 *
 * Vérifie que checkRateLimit() fait fail-open quand Redis est indisponible,
 * et que le module redis ne crash pas le process Node.js en cas d'erreur.
 *
 * Scénarios :
 *   1. Redis down (ECONNREFUSED simulé) → fail-open → { allowed: true }
 *   2. Redis down → checkRateLimit appelé plusieurs fois → toujours { allowed: true }
 *   3. Redis ETIMEDOUT simulé → fail-open → { allowed: true }
 *   4. REDIS_URL absent → getRedisInstance() throw → fail-open → { allowed: true }
 *   5. pipeline.exec() rejette → fail-open → { allowed: true }
 *
 * Ces tests ne démarrent PAS de connexion Redis réelle — tout est mocké.
 * Critère de succès : aucun des appels à checkRateLimit() ne throw,
 * et le process n'est pas crashé.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================
// Mock ioredis — on intercepte avant que le module crée une vraie connexion
// ============================================================

const mockPipelineExec = vi.fn()
const mockPipeline = vi.fn(() => ({
  zadd: vi.fn().mockReturnThis(),
  zremrangebyscore: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: mockPipelineExec,
}))

// Mock de l'instance Redis
const mockOn = vi.fn()
const mockRedisInstance = {
  on: mockOn,
  pipeline: mockPipeline,
}

// Mock de la classe Redis (constructeur)
vi.mock('ioredis', () => {
  return {
    default: vi.fn(() => mockRedisInstance),
  }
})

// Mock du logger pour éviter les logs parasites dans les tests
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

// ============================================================
// Import après les mocks
// ============================================================

// Note : on importe checkRateLimit directement — le module singleton sera
// réinitialisé entre chaque test via vi.resetModules() dans beforeEach.

describe('redis-resilience — checkRateLimit fail-open', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // Restaurer REDIS_URL pour les tests qui en ont besoin
    process.env['REDIS_URL'] = 'redis://wrong-host:6379'
  })

  afterEach(() => {
    delete process.env['REDIS_URL']
  })

  // ============================================================
  // Scénario 1 : pipeline.exec() rejette (ECONNREFUSED simulé)
  // ============================================================

  it('GIVEN Redis down (pipeline.exec rejette) WHEN checkRateLimit() THEN fail-open { allowed: true }', async () => {
    mockPipelineExec.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }),
    )

    // Import frais du module après resetModules
    const { checkRateLimit } = await import('@/lib/redis')

    const result = await checkRateLimit({
      key: 'rate:login:127.0.0.1',
      limit: 5,
      windowMs: 15 * 60 * 1000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(5)
    expect(result.resetAt).toBeInstanceOf(Date)
  })

  // ============================================================
  // Scénario 2 : appels multiples avec Redis down → toujours fail-open
  // ============================================================

  it('GIVEN Redis down WHEN checkRateLimit() appelé 3 fois THEN toutes les réponses sont fail-open', async () => {
    mockPipelineExec.mockRejectedValue(new Error('connect ETIMEDOUT'))

    const { checkRateLimit } = await import('@/lib/redis')

    const results = await Promise.all([
      checkRateLimit({ key: 'rate:login:127.0.0.1', limit: 5, windowMs: 900_000 }),
      checkRateLimit({ key: 'rate:magic:127.0.0.1', limit: 5, windowMs: 900_000 }),
      checkRateLimit({ key: 'rate:signup:127.0.0.1', limit: 10, windowMs: 3_600_000 }),
    ])

    for (const result of results) {
      expect(result.allowed).toBe(true)
    }
  })

  // ============================================================
  // Scénario 3 : REDIS_URL absent → throw dans getRedisInstance → fail-open
  // ============================================================

  it('GIVEN REDIS_URL absent WHEN checkRateLimit() THEN fail-open { allowed: true }', async () => {
    delete process.env['REDIS_URL']

    const { checkRateLimit } = await import('@/lib/redis')

    const result = await checkRateLimit({
      key: 'rate:login:127.0.0.1',
      limit: 5,
      windowMs: 15 * 60 * 1000,
    })

    expect(result.allowed).toBe(true)
  })

  // ============================================================
  // Scénario 4 : pipeline.exec() retourne null (connexion perdue mid-pipeline)
  // ============================================================

  it('GIVEN pipeline.exec() retourne null WHEN checkRateLimit() THEN currentCount=0 → allowed', async () => {
    mockPipelineExec.mockResolvedValueOnce(null)

    const { checkRateLimit } = await import('@/lib/redis')

    const result = await checkRateLimit({
      key: 'rate:login:127.0.0.1',
      limit: 5,
      windowMs: 15 * 60 * 1000,
    })

    // null pipeline result → currentCount=0 → allowed=true (0 <= 5)
    expect(result.allowed).toBe(true)
  })

  // ============================================================
  // Scénario 5 : Redis OK → checkRateLimit retourne le résultat réel
  // ============================================================

  it('GIVEN Redis OK et 3 requêtes précédentes WHEN checkRateLimit() THEN allowed=true remaining=2', async () => {
    // ZCARD retourne 3 (3 requêtes dans la fenêtre)
    mockPipelineExec.mockResolvedValueOnce([
      [null, 1],   // ZADD
      [null, 0],   // ZREMRANGEBYSCORE
      [null, 3],   // ZCARD → currentCount=3
      [null, 1],   // EXPIRE
    ])

    const { checkRateLimit } = await import('@/lib/redis')

    const result = await checkRateLimit({
      key: 'rate:login:127.0.0.1',
      limit: 5,
      windowMs: 15 * 60 * 1000,
    })

    expect(result.allowed).toBe(true)   // 3 <= 5
    expect(result.remaining).toBe(2)    // 5 - 3 = 2
  })

  // ============================================================
  // Scénario 6 : Redis OK mais limite dépassée → allowed=false
  // ============================================================

  it('GIVEN Redis OK et 6 requêtes (limite=5) WHEN checkRateLimit() THEN allowed=false', async () => {
    mockPipelineExec.mockResolvedValueOnce([
      [null, 1],   // ZADD
      [null, 0],   // ZREMRANGEBYSCORE
      [null, 6],   // ZCARD → currentCount=6
      [null, 1],   // EXPIRE
    ])

    const { checkRateLimit } = await import('@/lib/redis')

    const result = await checkRateLimit({
      key: 'rate:login:127.0.0.1',
      limit: 5,
      windowMs: 15 * 60 * 1000,
    })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  // ============================================================
  // Scénario 7 : checkRateLimit ne throw jamais (invariant de robustesse)
  // ============================================================

  it('GIVEN toute erreur Redis WHEN checkRateLimit() THEN ne throw jamais', async () => {
    mockPipelineExec.mockRejectedValue(new Error('Connexion fermée'))

    const { checkRateLimit } = await import('@/lib/redis')

    // Le test échouerait si checkRateLimit throw
    await expect(
      checkRateLimit({ key: 'rate:login:127.0.0.1', limit: 5, windowMs: 900_000 }),
    ).resolves.toBeDefined()
  })
})
