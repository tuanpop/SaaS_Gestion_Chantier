/**
 * tests/e2e/login-redirect.spec.ts — Non-régression bug 2026-05-19
 *
 * BUG : Après login réussi, l'utilisateur voyait une 404 au lieu de son dashboard.
 * CAUSE : POST /api/auth/login ne propageait pas les Set-Cookie Supabase dans sa réponse.
 *   Le navigateur n'avait jamais les tokens → getUser() = null sur toutes les pages → redirect /login
 *   OU middleware retournait 401 JSON sur une navigation de page → Next.js affichait 404.
 * FIX : (1) Route login utilise createServerClient avec setAll sur NextResponse mutable.
 *        (2) Middleware redirige vers /login au lieu de retourner 401 JSON pour les pages.
 *        (3) Matcher corrigé : /admin/:path* et /conducteur/:path* (segments réels).
 *
 * Prérequis :
 *   - `supabase start` — Supabase local running
 *   - `npm run dev` — Next.js dev server running (port 3000)
 *   - Redis running
 *   - hook PG custom_access_token_hook actif en local
 *   - .env.local avec NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY, QR_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL, REDIS_URL
 */

import { test, expect } from '@playwright/test'
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
// Setup / Teardown
// ============================================================

test.beforeEach(async () => {
  // Purger le rate limit Redis avant chaque test (évite les 429 inter-tests)
  await clearAllRateLimitsForLocalhost()
})

test.afterAll(async () => {
  await cleanupTestResources(resources)
})

// ============================================================
// Scénarios de non-régression
// ============================================================

/**
 * NR-01 — Login admin → redirect /admin/chantiers (pas 404)
 *
 * Ce test vérifie exactement le bug : après login réussi, l'utilisateur
 * doit atterrir sur /admin/chantiers, pas sur une 404.
 */
test('NR-01 — Login admin redirige vers /admin/chantiers sans 404', async ({ page }) => {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  // Créer un compte admin de test via Supabase direct (plus rapide)
  const org = await createTestOrganisationDirect(resources)

  // Écouter les erreurs réseau et les 404
  const fourOhFourResponses: string[] = []
  page.on('response', (response) => {
    if (response.status() === 404) {
      fourOhFourResponses.push(`${response.status()} ${response.url()}`)
    }
  })

  // Aller sur la page login
  await page.goto(`${baseUrl}/login`)
  await expect(page).toHaveTitle(/ClawBTP/)

  // Remplir et soumettre le formulaire
  await page.getByLabel('Adresse email').fill(org.email)
  await page.getByLabel('Mot de passe').fill(org.password)
  await page.getByRole('button', { name: 'Connexion' }).click()

  // Attendre la navigation vers /admin/chantiers
  // Timeout 10s — inclut le temps de redirect server-side
  await page.waitForURL(`${baseUrl}/admin/chantiers`, { timeout: 10_000 })

  // Vérifications
  expect(page.url()).toBe(`${baseUrl}/admin/chantiers`)
  expect(fourOhFourResponses).toHaveLength(0)

  // La page doit rendre le contenu admin (titre ou lien de création)
  await expect(page.getByRole('heading', { name: 'Chantiers' })).toBeVisible({ timeout: 5_000 })
})

/**
 * NR-02 — Cookies Set-Cookie présents dans la réponse POST /api/auth/login
 *
 * Ce test vérifie directement que la réponse HTTP du login porte bien
 * les Set-Cookie headers. Sans eux, la session ne persiste pas côté navigateur.
 */
test('NR-02 — POST /api/auth/login porte bien les Set-Cookie headers', async ({ request }) => {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  // Créer un compte admin de test
  const org = await createTestOrganisationDirect(resources)

  const response = await request.post(`${baseUrl}/api/auth/login`, {
    data: { email: org.email, password: org.password },
  })

  // Vérifier le statut 200
  expect(response.status()).toBe(200)

  // Vérifier que la réponse porte des cookies (au moins le access token Supabase)
  const headers = response.headers()
  const setCookieHeader = headers['set-cookie'] ?? ''

  // Supabase SSR génère des cookies avec le préfixe sb- ou supabase-auth-token
  expect(setCookieHeader).toBeTruthy()
  // Le cookie doit mentionner le token de session Supabase (sb- est le préfixe @supabase/ssr)
  expect(setCookieHeader).toMatch(/sb-/)
})

/**
 * NR-03 — Middleware redirige vers /login (pas 401 JSON) pour une page protégée sans session
 *
 * Ce test vérifie que le middleware ne retourne pas 401 JSON sur une navigation
 * de page, ce qui produisait une 404 dans Next.js 15.
 */
test('NR-03 — Accès /admin/chantiers sans session redirige vers /login', async ({ page }) => {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  // Intercepter les réponses pour détecter un JSON 401 inattendu
  const unexpectedJsonResponses: string[] = []
  page.on('response', (response) => {
    const contentType = response.headers()['content-type'] ?? ''
    if (
      response.status() === 401 &&
      contentType.includes('application/json') &&
      !response.url().includes('/api/')
    ) {
      unexpectedJsonResponses.push(response.url())
    }
  })

  // Accéder directement à /admin/chantiers sans session
  await page.goto(`${baseUrl}/admin/chantiers`)

  // Doit être redirigé vers /login (pas de 404, pas de 401 JSON pour page)
  await page.waitForURL(`${baseUrl}/login*`, { timeout: 5_000 })
  expect(page.url()).toContain('/login')
  expect(unexpectedJsonResponses).toHaveLength(0)
})

/**
 * NR-04 — Login conducteur redirige vers /conducteur/chantiers (pas 404)
 *
 * Vérifie le même flow pour le rôle conducteur.
 */
test('NR-04 — Login conducteur redirige vers /conducteur/chantiers sans 404', async ({ page }) => {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  // Créer un org avec un admin, puis créer un conducteur via l'API
  const adminOrg = await createTestOrganisationDirect(resources)

  // Créer un conducteur via l'API admin
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminOrg.email, password: adminOrg.password }),
  })
  expect(adminLoginRes.ok).toBe(true)

  // Extraire les cookies de la réponse admin pour les passer à la création conducteur
  const setCookies = adminLoginRes.headers.get('set-cookie') ?? ''
  const conducteurEmail = `conducteur-${crypto.randomUUID()}@e2e-clawbtp.test`
  const conducteurPassword = `ConductPass${crypto.randomUUID().slice(0, 8)}!`

  const createUserRes = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: setCookies,
    },
    body: JSON.stringify({
      email: conducteurEmail,
      password: conducteurPassword,
      nom: 'Dupont',
      prenom: 'Jean',
      role: 'conducteur',
    }),
  })
  // Si 201 → conducteur créé. Si 400/401 → skip le test (auth hook local peut ne pas avoir le claim)
  test.skip(createUserRes.status !== 201, 'Conducteur non créé — auth hook local requis')

  const { data: conducteurData } = await createUserRes.json() as { data: { id: string } }
  resources.authUserIds.push(conducteurData.id)

  // Écouter les 404
  const fourOhFourResponses: string[] = []
  page.on('response', (response) => {
    if (response.status() === 404) {
      fourOhFourResponses.push(`${response.status()} ${response.url()}`)
    }
  })

  // Login conducteur
  await page.goto(`${baseUrl}/login`)
  await page.getByLabel('Adresse email').fill(conducteurEmail)
  await page.getByLabel('Mot de passe').fill(conducteurPassword)
  await page.getByRole('button', { name: 'Connexion' }).click()

  await page.waitForURL(`${baseUrl}/conducteur/chantiers`, { timeout: 10_000 })
  expect(page.url()).toBe(`${baseUrl}/conducteur/chantiers`)
  expect(fourOhFourResponses).toHaveLength(0)
})
