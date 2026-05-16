/**
 * tests/e2e/helpers/setup.ts — Helpers communs Playwright E2E
 *
 * Prérequis :
 *   - Supabase local running (`supabase start`)
 *   - Next.js dev server running (`npm run dev`)
 *   - Variables d'env définies dans .env.local (ou process.env) :
 *       NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL
 *
 * IMPORTANT : chaque test doit appeler cleanup() dans afterEach/afterAll
 * pour garantir l'idempotence (suppression des données créées).
 */

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import Redis from 'ioredis'
import type { Database } from '../../../types/database'

// ============================================================
// Admin client Supabase — bypass RLS pour les helpers de test
// DANGER : SUPABASE_SERVICE_ROLE_KEY côté serveur uniquement (jamais NEXT_PUBLIC_)
// Dans les tests E2E, ce code tourne Node.js (jamais dans un browser bundle)
// ============================================================

function createTestAdminClient(): SupabaseClient<Database> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!url || !serviceKey) {
    throw new Error(
      'Variables manquantes pour les tests E2E : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont obligatoires.',
    )
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// ============================================================
// Types
// ============================================================

export interface TestOrganisation {
  organisationId: string
  adminUserId: string
  email: string
  password: string
}

export interface CreatedResources {
  organisationIds: string[]
  authUserIds: string[]
}

// ============================================================
// Factory : créer une organisation de test avec admin
// Utilise POST /api/organisations (flux réel — test de bout en bout)
// ============================================================

/**
 * Crée une organisation de test via l'API (flux complet).
 * Retourne les IDs créés pour le cleanup.
 */
export async function createTestOrganisation(
  email?: string,
  password?: string,
): Promise<TestOrganisation> {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  const testEmail = email ?? `test-${crypto.randomUUID()}@e2e-clawbtp.test`
  const testPassword = password ?? `TestPass${crypto.randomUUID().slice(0, 8)}!`

  const res = await fetch(`${baseUrl}/api/organisations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      name: `Test Organisation ${crypto.randomUUID().slice(0, 6)}`,
      secteur: 'BTP Test',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`createTestOrganisation failed (${res.status}): ${body}`)
  }

  const { data } = await res.json() as { data: { organisation_id: string; user_id: string } }

  return {
    organisationId: data.organisation_id,
    adminUserId: data.user_id,
    email: testEmail,
    password: testPassword,
  }
}

// ============================================================
// Factory : créer une organisation directement via adminClient (bypass API)
// Utile pour créer des états initiaux précis (ex: statut='trial_expired')
// ============================================================

/**
 * Crée une organisation directement en DB (bypass API) pour des états précis.
 * Utiliser quand on a besoin de contrôler le statut (ex: trial_expired).
 */
export async function createTestOrganisationDirect(opts: {
  statut?: 'trial_active' | 'trial_expired' | 'active' | 'suspended'
  trialDaysOffset?: number  // positif = dans le futur, négatif = dans le passé
}): Promise<{ organisationId: string; adminUserId: string; email: string; password: string }> {
  const adminClient = createTestAdminClient()

  const testEmail = `test-${crypto.randomUUID()}@e2e-clawbtp.test`
  const testPassword = `TestPass${crypto.randomUUID().slice(0, 8)}!`

  const trialEndsAt = new Date()
  const daysOffset = opts.trialDaysOffset ?? 14
  trialEndsAt.setDate(trialEndsAt.getDate() + daysOffset)

  // Créer organisation
  const { data: org, error: orgError } = await adminClient
    .from('organisations')
    .insert({
      name: `Test Org ${crypto.randomUUID().slice(0, 6)}`,
      plan: 'starter',
      statut: opts.statut ?? 'trial_active',
      trial_ends_at: trialEndsAt.toISOString(),
    })
    .select('id')
    .single()

  if (orgError || !org) {
    throw new Error(`createTestOrganisationDirect: org insert failed — ${orgError?.message}`)
  }

  // Créer auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    app_metadata: { organisation_id: org.id, role: 'admin' },
    email_confirm: true,
  })

  if (authError || !authData.user) {
    // Rollback
    await adminClient.from('organisations').delete().eq('id', org.id)
    throw new Error(`createTestOrganisationDirect: auth user creation failed — ${authError?.message}`)
  }

  // Créer fiche users
  const { error: userError } = await adminClient.from('users').insert({
    id: authData.user.id,
    organisation_id: org.id,
    role: 'admin',
    nom: 'Admin',
    prenom: 'Test',
    email: testEmail,
    has_supabase_auth: true,
    invitation_status: 'active',
    telephone: null,
    qr_token: null,
    avatar_url: null,
  })

  if (userError) {
    throw new Error(`createTestOrganisationDirect: users insert failed — ${userError.message}`)
  }

  return {
    organisationId: org.id,
    adminUserId: authData.user.id,
    email: testEmail,
    password: testPassword,
  }
}

// ============================================================
// Modifier le statut d'une organisation (ex: forcer trial_expired)
// ============================================================

/**
 * Force le statut d'une organisation directement en DB.
 * Utilisé dans US-001 S3 : forcer trial_expired sans attendre 14 jours.
 */
export async function setOrganisationStatut(
  organisationId: string,
  statut: 'trial_active' | 'trial_expired' | 'active' | 'suspended',
): Promise<void> {
  const adminClient = createTestAdminClient()

  const { error } = await adminClient
    .from('organisations')
    .update({ statut })
    .eq('id', organisationId)

  if (error) {
    throw new Error(`setOrganisationStatut failed: ${error.message}`)
  }
}

// ============================================================
// Cleanup — supprimer les ressources créées pendant le test
// OBLIGATOIRE dans afterEach/afterAll pour garantir l'idempotence
// ============================================================

/**
 * Supprime les organisations et auth users créés pendant le test.
 * L'ordre est important : auth users avant organisations (FK constraint).
 */
export async function cleanupTestResources(resources: CreatedResources): Promise<void> {
  const adminClient = createTestAdminClient()

  // 1. Supprimer les fiches users (FK -> organisations)
  if (resources.organisationIds.length > 0) {
    await adminClient
      .from('users')
      .delete()
      .in('organisation_id', resources.organisationIds)
  }

  // 2. Supprimer les auth users Supabase
  for (const authUserId of resources.authUserIds) {
    await adminClient.auth.admin.deleteUser(authUserId)
  }

  // 3. Supprimer les organisations
  if (resources.organisationIds.length > 0) {
    await adminClient
      .from('organisations')
      .delete()
      .in('id', resources.organisationIds)
  }
}

// ============================================================
// Helper : login admin et récupérer les cookies de session
// ============================================================

/**
 * Effectue un login via POST /api/auth/login.
 * Retourne les headers de la réponse (contenant les cookies Supabase).
 */
export async function loginAdmin(
  email: string,
  password: string,
): Promise<Response> {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  })

  return res
}

// ============================================================
// Helper : parser les Set-Cookie headers pour les passer à Playwright
// ============================================================

/**
 * Extrait les cookies Supabase depuis les Set-Cookie headers d'une réponse de login.
 * Utile pour injecter la session dans le contexte Playwright.
 */
export function extractCookies(response: Response): string[] {
  const cookies: string[] = []
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      cookies.push(value)
    }
  })
  return cookies
}

// ============================================================
// Helper : reset du rate limit Redis entre les tests
//
// Le rate limit est sur l'IP (127.0.0.1 en local) et persiste entre tests.
// S3 brute force (5 tentatives login échouées) épuise la clé rate:login:127.0.0.1,
// ce qui fait que S1 (credentials incorrects) reçoit 429 au lieu de 401.
// Ce helper DEL la clé Redis pour garantir l'isolation des tests.
//
// Utilisation : appeler dans beforeEach / afterEach des tests sensibles au rate limit.
// ============================================================

function createTestRedisClient(): Redis {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: false,
  })
}

/**
 * Supprime les clés Redis de rate limiting pour une IP ou un pattern de clé.
 * Pattern accepté : ex. 'rate:login:127.0.0.1', 'rate:magic:127.0.0.1', 'rate:signup:*'
 *
 * @param keyPattern - Clé exacte ou pattern glob Redis (ex: 'rate:login:127.0.0.1')
 */
export async function clearRateLimit(keyPattern: string): Promise<void> {
  const redis = createTestRedisClient()
  try {
    if (keyPattern.includes('*')) {
      // Pattern glob — utiliser SCAN pour trouver et supprimer
      const keys = await redis.keys(keyPattern)
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } else {
      // Clé exacte — DEL direct
      await redis.del(keyPattern)
    }
  } finally {
    await redis.quit()
  }
}

/**
 * Supprime toutes les clés de rate limiting pour l'IP loopback (127.0.0.1).
 * À appeler en beforeEach dans les tests qui vérifient les status HTTP d'auth.
 */
export async function clearAllRateLimitsForLocalhost(): Promise<void> {
  await Promise.all([
    clearRateLimit('rate:login:127.0.0.1'),
    clearRateLimit('rate:magic:127.0.0.1'),
    clearRateLimit('rate:signup:127.0.0.1'),
  ])
}
