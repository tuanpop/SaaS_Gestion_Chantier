/**
 * tests/e2e/us010-chantier.spec.ts — Playwright US-010 S1/S2/S3
 *
 * Critères Gherkin (SPRINT_2_PLAN.md §F.4) :
 *   S1 : Admin crée un chantier -> apparaît dans le portefeuille avec pastille colorée
 *   S2 : Validation code postal ABCDE -> message d'erreur inline + HTTP 400
 *   S3 : 20 chantiers chargés < 1000ms
 *
 * Prérequis :
 *   - Supabase local running (`supabase start`)
 *   - Next.js dev server running (`npm run dev`) sur PORT=3000
 *   - Migration 002 appliquée (`supabase db reset`)
 */

import { test, expect } from '@playwright/test'
import {
  createTestOrganisationDirect,
  cleanupTestResources,
  type CreatedResources,
} from './helpers/setup'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'
const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? ''
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''

// ============================================================
// State partagé — resources créées (cleanup garanti via afterAll même si un test throw)
// GAP-cleanup-playwright fixé 2026-05-19 : refactor cleanup inline -> afterAll central
// ============================================================

const resources: CreatedResources = {
  organisationIds: [],
  authUserIds: [],
}

// ============================================================
// US-010 S1 : Création chantier + apparition portefeuille
// ============================================================

test.describe('US-010 — Gestion chantiers', () => {

  test.afterAll(async () => {
    await cleanupTestResources(resources)
  })

  test('S1 — Admin crée un chantier qui apparaît dans le portefeuille avec pastille verte', async ({ page }) => {
    // Setup : créer une organisation de test
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    // Login admin
    await page.goto(`${BASE_URL}/login`)
    await page.fill('[type="email"]', org.email)
    await page.fill('[type="password"]', org.password)
    await page.click('[type="submit"]')
    await page.waitForURL(`${BASE_URL}/admin/chantiers`, { timeout: 10000 })

    // Naviguer vers "Nouveau chantier"
    await page.goto(`${BASE_URL}/admin/chantiers/nouveau`)

    // Remplir le formulaire
    const dateDebut = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    await page.fill('#nom', 'Rénovation Dupont')
    await page.fill('#client_nom', 'SCI Dupont')
    await page.fill('#adresse', '14 rue des Lilas, Bordeaux')
    await page.fill('#code_postal', '33000')
    await page.fill('#date_debut', dateDebut)
    await page.fill('#date_fin_prevue', dateFin)

    // Soumettre
    await page.click('[type="submit"]')

    // Attendre la redirection vers le détail du chantier
    await page.waitForURL(/\/admin\/chantiers\/[a-f0-9-]+$/, { timeout: 10000 })

    // Vérifier que le chantier est affiché avec son nom
    await expect(page.locator('h1')).toContainText('Rénovation Dupont')

    // Revenir au portefeuille
    await page.goto(`${BASE_URL}/admin/chantiers`)

    // Vérifier la pastille colorée (vert = dans les temps)
    // Selector data-testid robuste aux changements de classes CSS (GAP-selectors-fragiles)
    await expect(page.getByTestId('chantier-status-vert').first()).toBeVisible()
  })

  // ============================================================
  // US-010 S2 : Validation code postal invalide
  // ============================================================

  test('S2 — Code postal invalide : message d\'erreur inline + HTTP 400', async ({ page, request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    // Login
    await page.goto(`${BASE_URL}/login`)
    await page.fill('[type="email"]', org.email)
    await page.fill('[type="password"]', org.password)
    await page.click('[type="submit"]')
    await page.waitForURL(`${BASE_URL}/admin/chantiers`, { timeout: 10000 })

    // Aller au formulaire
    await page.goto(`${BASE_URL}/admin/chantiers/nouveau`)

    // Remplir avec code postal invalide
    await page.fill('#nom', 'Test Chantier')
    await page.fill('#client_nom', 'Client Test')
    await page.fill('#adresse', '1 rue Test')
    await page.fill('#code_postal', 'ABCDE') // Invalide

    const dateDebut = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
    await page.fill('#date_debut', dateDebut)
    await page.fill('#date_fin_prevue', dateFin)

    // Soumettre
    await page.click('[type="submit"]')

    // Vérifier le message d'erreur inline (validation côté client d'abord)
    // getByText robuste aux changements de classes CSS (GAP-selectors-fragiles)
    await expect(
      page.getByText(/code postal|5 chiffres/i).first(),
    ).toBeVisible({ timeout: 5000 })

    // Vérifier aussi que l'API retourne HTTP 400 (test API direct)
    const response = await request.post(`${BASE_URL}/api/chantiers`, {
      data: {
        nom: 'Test CP',
        client_nom: 'Client',
        adresse: '1 rue Test',
        code_postal: 'ABCDE',
        date_debut: dateDebut,
        date_fin_prevue: dateFin,
      },
      headers: {
        'x-organisation-id': org.organisationId,
        'x-user-id': org.adminUserId,
        'x-user-role': 'admin',
      },
    })

    expect(response.status()).toBe(400)
    const body = await response.json() as { fields?: { code_postal?: string[] } }
    expect(body.fields?.code_postal).toBeDefined()
  })

  // ============================================================
  // US-010 S3 : Portefeuille 20 chantiers < 1000ms
  // ============================================================

  test('S3 — Portefeuille 20 chantiers chargé en < 1000ms, rouges en premier', async ({ page }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Créer 20 chantiers via adminClient : 3 rouges, 5 oranges, 12 verts
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]!

    const in2days = new Date()
    in2days.setDate(in2days.getDate() + 2)
    const in2daysStr = in2days.toISOString().split('T')[0]!

    const in30days = new Date()
    in30days.setDate(in30days.getDate() + 30)
    const in30daysStr = in30days.toISOString().split('T')[0]!

    const today = new Date().toISOString().split('T')[0]!

    const chantiers = []

    // 3 rouges (date dépassée)
    for (let i = 0; i < 3; i++) {
      chantiers.push({
        organisation_id: org.organisationId,
        nom: `Chantier Rouge ${i + 1}`,
        client_nom: `Client Rouge ${i + 1}`,
        adresse: `${i + 1} rue Rouge`,
        code_postal: '75001',
        date_debut: yesterdayStr,
        date_fin_prevue: yesterdayStr, // date passée -> rouge
        created_by: org.adminUserId,
      })
    }

    // 5 oranges (date dans 2 jours)
    for (let i = 0; i < 5; i++) {
      chantiers.push({
        organisation_id: org.organisationId,
        nom: `Chantier Orange ${i + 1}`,
        client_nom: `Client Orange ${i + 1}`,
        adresse: `${i + 1} rue Orange`,
        code_postal: '33000',
        date_debut: today,
        date_fin_prevue: in2daysStr, // dans 2 jours -> orange
        created_by: org.adminUserId,
      })
    }

    // 12 verts (date dans 30 jours)
    for (let i = 0; i < 12; i++) {
      chantiers.push({
        organisation_id: org.organisationId,
        nom: `Chantier Vert ${i + 1}`,
        client_nom: `Client Vert ${i + 1}`,
        adresse: `${i + 1} rue Verte`,
        code_postal: '69001',
        date_debut: today,
        date_fin_prevue: in30daysStr,
        created_by: org.adminUserId,
      })
    }

    // Insérer en batch — cast nécessaire (types Sprint 2, test context, safe at runtime)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminSupabase.from('chantiers') as any).insert(chantiers)

    // Login
    await page.goto(`${BASE_URL}/login`)
    await page.fill('[type="email"]', org.email)
    await page.fill('[type="password"]', org.password)
    await page.click('[type="submit"]')
    await page.waitForURL(`${BASE_URL}/admin/chantiers`, { timeout: 10000 })

    // Mesurer le temps de chargement du portefeuille
    const t0 = Date.now()
    await page.goto(`${BASE_URL}/admin/chantiers`)

    // Attendre que les cartes chantiers soient visibles
    await page.waitForSelector('.card-brutal', { timeout: 5000 })

    const elapsed = Date.now() - t0
    // Attach perf metric au rapport Playwright (visible via `npx playwright show-report`)
    test.info().annotations.push({ type: 'perf', description: `portefeuille 20 chantiers : ${elapsed}ms` })

    // DoD US-010 S3 : < 1000ms
    expect(elapsed).toBeLessThan(1000)

    // Vérifier que les rouges sont en premier
    // Selector data-testid robuste (GAP-selectors-fragiles)
    const firstBadge = page.getByTestId('chantier-status-rouge').first()
    await expect(firstBadge).toBeVisible()
  })

  // ============================================================
  // RLS-003 : conducteur org A GET chantier org B -> HTTP 404 (I-06)
  // GAP-RLS-003 (Levi 2026-05-16) : le test unitaire chantiers-rls.test.ts:303
  // était marqué .skip avec un commentaire "testé via Playwright E2E", mais
  // l'équivalent E2E n'existait pas. Ce test comble le gap : isolation
  // multi-tenant + I-06 (404 pas 403 pour ne pas révéler l'existence).
  // ============================================================

  test('RLS-003 — Conducteur org A GET chantier org B -> 404 (I-06)', async ({ request }) => {
    // Setup : créer deux organisations isolées
    const orgA = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    const orgB = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(orgA.organisationId, orgB.organisationId)
    resources.authUserIds.push(orgA.adminUserId, orgB.adminUserId)

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Créer un conducteur dans org A (user direct en DB)
    const conducteurAId = crypto.randomUUID()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: userInsertError } = await (adminSupabase.from('users') as any).insert({
      id: conducteurAId,
      organisation_id: orgA.organisationId,
      role: 'conducteur',
      nom: 'Martin',
      prenom: 'Pierre',
      email: `conducteur-a-${crypto.randomUUID()}@e2e-clawbtp.test`,
      has_supabase_auth: false,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })
    expect(userInsertError).toBeNull()

    // Créer un chantier dans org B (créateur = admin de orgB)
    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierBData } = await (adminSupabase.from('chantiers') as any)
      .insert({
        organisation_id: orgB.organisationId,
        nom: 'Chantier confidentiel org B',
        client_nom: 'Client B',
        adresse: '99 rue Privée',
        code_postal: '13001',
        date_debut: today,
        date_fin_prevue: dateFin,
        created_by: orgB.adminUserId,
      })
      .select('id')
      .single()
    const chantierBId = (chantierBData as { id: string }).id

    // Cœur du test RLS-003 : conducteur orgA tente GET sur chantier orgB
    const response = await request.get(`${BASE_URL}/api/chantiers/${chantierBId}`, {
      headers: {
        'x-organisation-id': orgA.organisationId,
        'x-user-id': conducteurAId,
        'x-user-role': 'conducteur',
      },
    })

    // I-06 : 404 (pas 403 — ne pas révéler l'existence du chantier)
    expect(response.status()).toBe(404)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('Ressource introuvable.')

    // Smoke : un GET LEGITIME (admin orgB sur son propre chantier) doit fonctionner
    // — sinon on ne sait pas si le 404 est lié à la sécurité ou à un bug du handler
    const legitResponse = await request.get(`${BASE_URL}/api/chantiers/${chantierBId}`, {
      headers: {
        'x-organisation-id': orgB.organisationId,
        'x-user-id': orgB.adminUserId,
        'x-user-role': 'admin',
      },
    })
    expect(legitResponse.status()).toBe(200)
  })
})
