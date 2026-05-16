import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Type structurel minimal pour accepter tout SupabaseClient<Database, ...> quel que soit le
// nombre de paramètres génériques résolus par createServerClient / createAdminClient.
// En utilisant Pick<> sur la seule méthode utilisée (from), on évite les incompatibilités
// de paramètres génériques entre @supabase/ssr et @supabase/supabase-js.
type AnySupabaseClient = Pick<SupabaseClient<Database>, 'from'>
import { PaymentRequiredError } from '@/lib/errors'
import { logger } from '@/lib/logger'

// Cache Redis importé dynamiquement pour éviter des erreurs au build
// (Redis n'est pas disponible au build time de Next.js)
let redisModule: typeof import('@/lib/redis') | null = null

async function getRedis() {
  if (!redisModule) {
    redisModule = await import('@/lib/redis')
  }
  return redisModule.redis
}

// ============================================================
// Types
// ============================================================

export interface TrialGateResult {
  blocked: boolean
  reason?: 'trial_expired' | 'not_found'
}

// ============================================================
// checkTrialGate — vérifie si l'organisation est bloquée
// ============================================================

/**
 * Vérifie si l'organisation peut effectuer des mutations.
 * Bloqué si :
 *   - statut = 'trial_expired'
 *   - trial_ends_at < NOW() (même si statut != 'trial_expired')
 *   - organisation introuvable
 *
 * Résultat mis en cache Redis 60s (clé `trial:{orgId}`)
 * pour éviter une requête DB à chaque mutation. (SPRINT_1_PLAN.md §1.7)
 */
export async function checkTrialGate(
  supabase: AnySupabaseClient,
  organisationId: string,
): Promise<TrialGateResult> {
  const cacheKey = `trial:${organisationId}`

  // Tentative de lecture depuis le cache Redis
  try {
    const redis = await getRedis()
    const cached = await redis.get(cacheKey)
    if (cached !== null) {
      const parsed = JSON.parse(cached) as TrialGateResult
      logger.debug({ organisationId, cached: true }, 'trial-gate: cache hit')
      return parsed
    }
  } catch (err) {
    // Cache indisponible -> continuer sans cache (fail-open sur le cache uniquement)
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), organisationId },
      'trial-gate: Redis cache miss — falling back to DB',
    )
  }

  // Requête DB
  const { data: org, error } = await supabase
    .from('organisations')
    .select('id, statut, trial_ends_at')
    .eq('id', organisationId)
    .single()

  if (error || !org) {
    logger.warn({ organisationId, error: error?.message }, 'trial-gate: organisation not found')
    const result: TrialGateResult = { blocked: true, reason: 'not_found' }
    await cacheSaveResult(cacheKey, result)
    return result
  }

  // Vérification : statut explicitement expiré
  if (org.statut === 'trial_expired' || org.statut === 'suspended') {
    const result: TrialGateResult = { blocked: true, reason: 'trial_expired' }
    await cacheSaveResult(cacheKey, result)
    return result
  }

  // Vérification : trial_ends_at dépassé (même si statut != 'trial_expired')
  // Important : on vérifie la date même si le statut n'a pas encore été mis à jour
  const trialEndsAt = new Date(org.trial_ends_at)
  if (trialEndsAt < new Date()) {
    logger.info(
      { organisationId, trial_ends_at: org.trial_ends_at, statut: org.statut },
      'trial-gate: trial_ends_at dépassé mais statut pas encore mis à jour',
    )
    const result: TrialGateResult = { blocked: true, reason: 'trial_expired' }
    await cacheSaveResult(cacheKey, result)
    return result
  }

  // Actif
  const result: TrialGateResult = { blocked: false }
  await cacheSaveResult(cacheKey, result)
  return result
}

// ============================================================
// assertTrialActive — throw PaymentRequiredError si bloqué
// Branchement obligatoire sur TOUS les handlers POST/PUT/PATCH/DELETE (D-012)
// ============================================================

/**
 * Vérifie que l'organisation peut effectuer des mutations.
 * Throw PaymentRequiredError (HTTP 402) si le trial est expiré ou l'organisation suspendue.
 *
 * OBLIGATOIRE : appelé en début de chaque handler POST/PUT/PATCH/DELETE,
 * après le check d'auth, avant toute logique métier. (D-012)
 */
export async function assertTrialActive(
  supabase: AnySupabaseClient,
  organisationId: string,
): Promise<void> {
  const result = await checkTrialGate(supabase, organisationId)
  if (result.blocked) {
    throw new PaymentRequiredError()
  }
}

// ============================================================
// Helpers internes
// ============================================================

async function cacheSaveResult(key: string, result: TrialGateResult): Promise<void> {
  try {
    const redis = await getRedis()
    // TTL 60 secondes
    await redis.set(key, JSON.stringify(result), 'EX', 60)
  } catch (err) {
    // Cache non critique — ne pas bloquer si Redis est indisponible
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), key },
      'trial-gate: failed to cache result',
    )
  }
}
