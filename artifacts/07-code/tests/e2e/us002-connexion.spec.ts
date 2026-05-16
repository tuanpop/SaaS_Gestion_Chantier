/**
 * tests/e2e/us002-connexion.spec.ts — Tests Playwright US-002
 *
 * Prérequis :
 *   - `supabase start` — Supabase local running
 *   - `npm run dev` — Next.js dev server running (port 3000 par défaut)
 *   - Redis running (pour le rate limiting)
 *   - .env.local avec : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY, QR_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL, REDIS_URL
 *
 * Scénarios couverts (SPRINT_1_PLAN.md §Mapping US-002) :
 *   S1 : Login email+password -> session créée, JWT contient organisation_id + role
 *   S2 : Magic link demande -> réponse fictive succès (I-04)
 *   S3 : 6ème tentative login -> 429 rate limit (D-01, après 5 tentatives échouées)
 *
 * Note S3 : Le rate limit est sur l'IP, et les tests Playwright tournent sur localhost.
 * En CI, s'assurer que Redis est disponible et que le rate limit Redis est purgé avant le test.
 *
 * Cleanup : afterAll supprime les ressources créées.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import {
  createTestOrganisationDirect,
  cleanupTestResources,
  clearAllRateLimitsForLocalhost,
  type CreatedResources,
} from './helpers/setup'

// ============================================================
// State partagé
// ============================================================

const resources: CreatedResources = {
  organisationIds: [],
  authUserIds: [],
}

// ============================================================
// Helpers
// ============================================================

async function fillLoginForm(page: Page, email: string, password: string) {
  await page.getByLabel('Adresse email').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
}

/**
 * Effectue N tentatives de login échouées via l'API directement.
 * Plus rapide que via l'UI pour les tests de rate limiting.
 */
async function performFailedLoginAttempts(
  request: APIRequestContext,
  baseUrl: string,
  email: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await request.post(`${baseUrl}/api/auth/login`, {
      data: {
        email,
        password: 'WrongPassword123!Invalid',
      },
    })
  }
}

// ============================================================
// Tests
// ============================================================

test.describe('US-002 — Connexion sécurisée', () => {

  test.afterAll(async () => {
    await cleanupTestResources(resources)
  })

  // Reset du rate limit Redis avant chaque test pour garantir l'isolation.
  // Le rate limit est sur l'IP 127.0.0.1 et persiste entre tests dans le même process.
  // Sans ce reset, S3 (brute force 5 tentatives) épuise le quota avant S1 (credentials incorrects).
  test.beforeEach(async () => {
    await clearAllRateLimitsForLocalhost()
  })

  // ----------------------------------------------------------
  // S1 : Connexion email + password
  // ----------------------------------------------------------

  test('S1 — Connexion email+password : JWT avec organisation_id + role', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    const res = await request.post(`${baseUrl}/api/auth/login`, {
      data: { email: org.email, password: org.password },
    })

    // HTTP 200 sur connexion réussie
    expect(res.status()).toBe(200)

    const body = await res.json() as {
      data: {
        user: {
          id: string
          email: string
          role: string | null
          organisation_id: string | null
        }
      }
    }

    // Vérifier la structure de la réponse
    expect(body.data).toBeDefined()
    expect(body.data.user).toBeDefined()
    expect(body.data.user.id).toBe(org.adminUserId)

    // T-01 : organisation_id et role doivent être présents (injectés par l'Auth Hook)
    expect(body.data.user.organisation_id).toBe(org.organisationId)
    expect(body.data.user.role).toBe('admin')
  })

  test('S1 — Connexion via la page /login : succès -> redirect vers /', async ({ page }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    await page.goto('/login')

    await fillLoginForm(page, org.email, org.password)

    await page.getByRole('button', { name: /Connexion$/i }).click()

    // Sur succès : redirect vers '/' (Sprint 2 gère la suite)
    await page.waitForURL('**/', { timeout: 5000 })
  })

  test('S1 — Credentials incorrects -> HTTP 401 + message générique (I-04)', async ({ request }) => {
    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    const res = await request.post(`${baseUrl}/api/auth/login`, {
      data: {
        email: `nonexistent-${crypto.randomUUID()}@e2e-clawbtp.test`,
        password: 'WrongPassword123!',
      },
    })

    expect(res.status()).toBe(401)

    const body = await res.json() as { error?: string }
    // I-04 : message générique, pas "email non trouvé" ou "mot de passe incorrect"
    expect(body.error).toBeDefined()
    expect(body.error!.toLowerCase()).not.toContain('trouvé')
    expect(body.error!.toLowerCase()).not.toContain('existe')
    expect(body.error!.toLowerCase()).not.toContain('not found')
  })

  // ----------------------------------------------------------
  // S2 : Magic link demande
  // ----------------------------------------------------------

  test('S2 — Magic link : réponse fictive succès quelle que soit l\'adresse (I-04)', async ({ request }) => {
    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    // Test avec un email inexistant
    const resUnknown = await request.post(`${baseUrl}/api/auth/magic-link`, {
      data: { email: `unknown-${crypto.randomUUID()}@nowhere.test` },
    })

    // I-04 : toujours HTTP 200 avec message fictif, même pour un email inexistant
    expect(resUnknown.status()).toBe(200)
    const bodyUnknown = await resUnknown.json() as { data?: { message?: string } }
    expect(bodyUnknown.data?.message).toContain("adresse est valide")
  })

  test('S2 — Magic link via la page /login : afficher confirmation après clic', async ({ page }) => {
    await page.goto('/login')

    // Saisir un email (valide ou non — la réponse est fictive)
    await page.getByLabel('Adresse email').fill(`test-magic-${crypto.randomUUID()}@e2e-clawbtp.test`)

    await page.getByRole('button', { name: /Recevoir un lien magique/i }).click()

    // Vérifier le message de confirmation affiché
    await expect(
      page.getByRole('status').filter({ hasText: /lien de connexion a été envoyé/i }),
    ).toBeVisible({ timeout: 3000 })
  })

  test('S2 — Magic link avec email existant : HTTP 200 (I-04 — réponse identique)', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    const res = await request.post(`${baseUrl}/api/auth/magic-link`, {
      data: { email: org.email },
    })

    // Toujours HTTP 200 (réponse fictive identique — I-04)
    expect(res.status()).toBe(200)

    const body = await res.json() as { data?: { message?: string } }
    expect(body.data?.message).toContain("adresse est valide")
  })

  // ----------------------------------------------------------
  // S3 : Brute force — 6ème tentative -> 429
  // ----------------------------------------------------------

  test('S3 — Brute force : 6ème tentative login -> 429 rate limit (D-01, 5 tentatives max/15min)', async ({ request }) => {
    // Note : Ce test utilise une IP spécifique. En CI, s'assurer que le Redis
    // est purgé entre les tests ou utiliser une clé Redis unique par test.
    // En dev local, le rate limit est sur l'IP 127.0.0.1 (loopback du test runner).

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    // Utiliser un email unique pour ce test (le rate limit est sur l'IP, pas l'email)
    const testEmail = `us002-s3-ratelimit-${crypto.randomUUID()}@e2e-clawbtp.test`

    // Effectuer les 5 premières tentatives (sous la limite)
    await performFailedLoginAttempts(request, baseUrl, testEmail, 5)

    // La 6ème tentative doit être bloquée par le rate limit
    const res = await request.post(`${baseUrl}/api/auth/login`, {
      data: {
        email: testEmail,
        password: 'AnyPassword123!',
      },
    })

    // D-01 : 429 après dépassement du rate limit (5/15min/IP)
    expect(res.status()).toBe(429)

    const body = await res.json() as { error?: string }
    expect(body.error).toBeDefined()
    // Le header Retry-After doit être présent
    const retryAfter = res.headers()['retry-after']
    expect(retryAfter).toBeDefined()
    expect(parseInt(retryAfter ?? '0', 10)).toBeGreaterThan(0)
  })
})
