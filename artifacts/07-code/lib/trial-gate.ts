import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Type structurel minimal pour accepter tout SupabaseClient<Database, ...> quel que soit le
// nombre de parametres generiques resolus par createServerClient / createAdminClient.
// En utilisant Pick<> sur la seule methode utilisee (from), on evite les incompatibilites
// de parametres generiques entre @supabase/ssr et @supabase/supabase-js.
type AnySupabaseClient = Pick<SupabaseClient<Database>, 'from'>

import { PaymentRequiredError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { cacheGet, cacheSet } from '@/lib/cache'

// ============================================================
// Types
// ============================================================

export interface TrialGateResult {
  blocked: boolean
  reason?: 'trial_expired' | 'not_found'
}

// ============================================================
// checkTrialGate — verifie si l'organisation est bloquee
// ============================================================

/**
 * Verifie si l'organisation peut effectuer des mutations.
 * Bloque si :
 *   - statut = 'trial_expired'
 *   - trial_ends_at < NOW() (meme si statut != 'trial_expired')
 *   - organisation introuvable
 *
 * Resultat mis en cache memoire process 60s (D-054 pivot Redis → cache memoire).
 * Cache store : 'trial-gate'. TTL : 60000ms.
 */
export async function checkTrialGate(
  supabase: AnySupabaseClient,
  organisationId: string,
): Promise<TrialGateResult> {
  const cacheKey = organisationId

  // Tentative de lecture depuis le cache memoire process (D-054)
  const cached = cacheGet<TrialGateResult>('trial-gate', cacheKey)
  if (cached !== null) {
    logger.debug({ organisationId, cached: true }, 'trial-gate: cache hit')
    return cached
  }

  // Requete DB
  const { data: org, error } = await supabase
    .from('organisations')
    .select('id, statut, trial_ends_at')
    .eq('id', organisationId)
    .single()

  if (error || !org) {
    logger.warn({ organisationId, error: error?.message }, 'trial-gate: organisation not found')
    const result: TrialGateResult = { blocked: true, reason: 'not_found' }
    cacheSaveResult(cacheKey, result)
    return result
  }

  // Verification : statut explicitement expire
  if (org.statut === 'trial_expired' || org.statut === 'suspended') {
    const result: TrialGateResult = { blocked: true, reason: 'trial_expired' }
    cacheSaveResult(cacheKey, result)
    return result
  }

  // Verification : trial_ends_at depasse (meme si statut != 'trial_expired')
  // Important : on verifie la date meme si le statut n'a pas encore ete mis a jour
  const trialEndsAt = new Date(org.trial_ends_at)
  if (trialEndsAt < new Date()) {
    logger.info(
      { organisationId, trial_ends_at: org.trial_ends_at, statut: org.statut },
      'trial-gate: trial_ends_at depasse mais statut pas encore mis a jour',
    )
    const result: TrialGateResult = { blocked: true, reason: 'trial_expired' }
    cacheSaveResult(cacheKey, result)
    return result
  }

  // Actif
  const result: TrialGateResult = { blocked: false }
  cacheSaveResult(cacheKey, result)
  return result
}

// ============================================================
// assertTrialActive — throw PaymentRequiredError si bloque
// Branchement obligatoire sur TOUS les handlers POST/PUT/PATCH/DELETE (D-012)
// ============================================================

/**
 * Verifie que l'organisation peut effectuer des mutations.
 * Throw PaymentRequiredError (HTTP 402) si le trial est expire ou l'organisation suspendue.
 *
 * OBLIGATOIRE : appele en debut de chaque handler POST/PUT/PATCH/DELETE,
 * apres le check d'auth, avant toute logique metier. (D-012)
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

function cacheSaveResult(key: string, result: TrialGateResult): void {
  // TTL 60 secondes = 60000ms (D-054 — identique a l'ancienne config Redis EX 60)
  cacheSet('trial-gate', key, result, 60_000)
}
