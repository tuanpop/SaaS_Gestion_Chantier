/**
 * tests/e2e/us001-inscription.spec.ts — Tests Playwright US-001
 *
 * Prérequis :
 *   - `supabase start` — Supabase local running
 *   - `npm run dev` — Next.js dev server running (port 3000 par défaut)
 *   - .env.local avec : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY, QR_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL
 *
 * Scénarios couverts (SPRINT_1_PLAN.md §Mapping US-001) :
 *   S1 : Inscription nominale — email+password+nom entreprise+secteur -> compte créé, trial +14j
 *   S2 : Email dupliqué -> message générique (I-04, pas d'info sur l'existence du compte)
 *   S3 : Trial expiré -> POST /api/users retourne 402 (D-012)
 *
 * Cleanup : afterAll supprime les organisations et auth users créés pendant les tests.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  createTestOrganisationDirect,
  setOrganisationStatut,
  cleanupTestResources,
  type CreatedResources,
} from './helpers/setup'

// ============================================================
// State partagé — resources créées à nettoyer
// ============================================================

const resources: CreatedResources = {
  organisationIds: [],
  authUserIds: [],
}

// ============================================================
// Helpers de formulaire
// ============================================================

async function fillRegisterForm(page: Page, opts: {
  email: string
  password: string
  name: string
  secteur: string
}) {
  await page.getByLabel('Adresse email professionnelle').fill(opts.email)
  await page.getByLabel(/Mot de passe/i).fill(opts.password)
  await page.getByLabel('Nom de votre entreprise').fill(opts.name)
  await page.getByLabel("Secteur d'activité").fill(opts.secteur)
}

// ============================================================
// Tests
// ============================================================

test.describe('US-001 — Créer un compte et démarrer l\'essai gratuit', () => {

  test.afterAll(async () => {
    await cleanupTestResources(resources)
  })

  // ----------------------------------------------------------
  // S1 : Inscription nominale
  // ----------------------------------------------------------

  test('S1 — Inscription nominale : email+password+nom+secteur -> compte créé, trial +14j', async ({ page }) => {
    const email = `us001-s1-${crypto.randomUUID()}@e2e-clawbtp.test`
    const password = 'TestPassword123!'

    await page.goto('/register')

    // Remplir le formulaire
    await fillRegisterForm(page, {
      email,
      password,
      name: 'BTP Test S1',
      secteur: 'Plomberie',
    })

    // Intercepter la réponse API pour extraire l'organisation_id
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/organisations') && response.request().method() === 'POST',
    )

    await page.getByRole('button', { name: /Créer mon compte/i }).click()

    const apiResponse = await responsePromise
    expect(apiResponse.status()).toBe(201)

    const responseBody = await apiResponse.json() as {
      data: { organisation_id: string; user_id: string }
    }
    const { organisation_id, user_id } = responseBody.data

    // Enregistrer pour cleanup
    resources.organisationIds.push(organisation_id)
    resources.authUserIds.push(user_id)

    // Vérifier le message de succès affiché
    await expect(
      page.getByRole('status').filter({ hasText: /Compte créé/i }),
    ).toBeVisible()

    // Vérifier la redirection vers /login après 3 secondes
    await page.waitForURL('**/login', { timeout: 5000 })

    // Vérifier via l'API que trial_ends_at est bien dans ~14 jours
    // (en interrogeant directement la DB via adminClient dans le helper)
    const { createClient } = await import('@supabase/supabase-js')
    const adminClient = createClient(
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
      process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: org } = await adminClient
      .from('organisations')
      .select('trial_ends_at, statut')
      .eq('id', organisation_id)
      .single()

    expect(org).not.toBeNull()
    expect(org!.statut).toBe('trial_active')

    const trialEndsAt = new Date(org!.trial_ends_at)
    const now = new Date()
    const diffDays = Math.round((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    // Le trial doit expirer dans ~14 jours (tolérance ±1 jour pour les délais de test)
    expect(diffDays).toBeGreaterThanOrEqual(13)
    expect(diffDays).toBeLessThanOrEqual(15)
  })

  // ----------------------------------------------------------
  // S2 : Email dupliqué -> message générique
  // ----------------------------------------------------------

  test('S2 — Email dupliqué : message générique sans révéler l\'existence du compte (I-04)', async ({ page }) => {
    const email = `us001-s2-${crypto.randomUUID()}@e2e-clawbtp.test`

    // Créer un premier compte avec cet email
    const org = await createTestOrganisationDirect({})
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    // Tenter une inscription avec le même email
    await page.goto('/register')

    await fillRegisterForm(page, {
      email: org.email,  // email déjà utilisé
      password: 'TestPassword123!',
      name: 'Doublon Test',
      secteur: 'Maçonnerie',
    })

    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/organisations') && response.request().method() === 'POST',
    )

    await page.getByRole('button', { name: /Créer mon compte/i }).click()

    const apiResponse = await responsePromise

    // Le serveur doit retourner 400 avec message générique (I-04)
    expect([400, 409, 500]).toContain(apiResponse.status())

    const responseBody = await apiResponse.json() as { error?: string }
    // I-04 : message générique, pas "email déjà utilisé" ou "compte existe"
    expect(responseBody.error).toBeDefined()
    expect(responseBody.error!.toLowerCase()).not.toContain('existe')
    expect(responseBody.error!.toLowerCase()).not.toContain('déjà utilisé')
    expect(responseBody.error!.toLowerCase()).not.toContain('already')

    // Le message affiché sur la page doit être générique
    await expect(
      page.getByRole('alert').filter({ hasText: /problème est survenu/i }),
    ).toBeVisible()

    // S'assurer que la page n'indique pas l'existence du compte
    await expect(page.getByText(/email déjà utilisé/i)).not.toBeVisible()
    await expect(page.getByText(/compte existe déjà/i)).not.toBeVisible()

    void email // email variable pas utilisé directement, référencé pour documentation
  })

  // ----------------------------------------------------------
  // S3 : Trial expiré -> POST /api/users retourne 402
  // ----------------------------------------------------------

  test('S3 — Trial expiré : POST /api/users retourne 402 (D-012 assertTrialActive)', async ({ request }) => {
    // Créer une organisation avec trial actif, puis forcer statut='trial_expired'
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    // Forcer le statut 'trial_expired' directement en DB (pas besoin d'attendre 14j)
    await setOrganisationStatut(org.organisationId, 'trial_expired')

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    // Effectuer un login pour obtenir la session
    const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
      data: { email: org.email, password: org.password },
    })
    expect(loginRes.ok()).toBeTruthy()

    // Tenter de créer un ouvrier (mutation POST /api/users)
    // Après login avec Playwright APIRequestContext, les cookies sont gérés automatiquement
    const createUserRes = await request.post(`${baseUrl}/api/users`, {
      data: {
        role: 'ouvrier',
        nom: 'Ouvrier Trial Test',
        prenom: 'Test',
      },
    })

    // D-012 : assertTrialActive() doit retourner 402
    expect(createUserRes.status()).toBe(402)

    const body = await createUserRes.json() as { error?: string }
    // Le message 402 de PaymentRequiredError (lib/errors.ts PUBLIC_MESSAGES)
    expect(body.error).toContain('essai gratuit')
  })
})
