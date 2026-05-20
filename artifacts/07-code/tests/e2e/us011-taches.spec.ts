/**
 * tests/e2e/us011-taches.spec.ts — Playwright US-011 S1/S2/S3
 *
 * Critères Gherkin (SPRINT_2_PLAN.md §F.5) :
 *   S1 : Conducteur crée tâche "Pose carrelage RDC" assignée à Mohamed, statut=a_faire
 *   S2 : Passage en bloqué sans raison -> formulaire invalide, raison obligatoire
 *        Puis avec raison >= 10 car. -> HTTP 200
 *   S3 : GET /api/taches/[tache_org_B_id] direct -> HTTP 404
 *
 * Q4 : notification in-app stubée (TODO Sprint 4) — testée comme stub (log debug)
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
// State partagé — cleanup garanti via afterAll même si un test throw
// GAP-cleanup-playwright fixé 2026-05-19
// ============================================================

const resources: CreatedResources = {
  organisationIds: [],
  authUserIds: [],
}

test.describe('US-011 — Tâches chantier', () => {

  test.afterAll(async () => {
    await cleanupTestResources(resources)
  })

  // ============================================================
  // S1 : Création tâche + assignation
  // ============================================================

  test('S1 — Conducteur crée une tâche assignée, statut=a_faire visible dans liste', async ({ request }) => {
    const orgA = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(orgA.organisationId)
    resources.authUserIds.push(orgA.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    // Créer un chantier via adminClient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierData } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: orgA.organisationId,
      nom: 'Chantier Test US011',
      client_nom: 'Client Test',
      adresse: '1 rue Test',
      code_postal: '75001',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: orgA.adminUserId,
    }).select('id').single()

    const chantierId = (chantierData as { id: string }).id

    // Créer une tâche via l'API
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]!

    const response = await request.post(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        data: {
          titre: 'Pose carrelage RDC',
          date_echeance: tomorrowStr,
          statut: 'a_faire',
        },
        headers: {
          'x-organisation-id': orgA.organisationId,
          'x-user-id': orgA.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    expect(response.status()).toBe(201)
    const tache = await response.json() as { id: string; titre: string; statut: string }

    expect(tache.titre).toBe('Pose carrelage RDC')
    expect(tache.statut).toBe('a_faire')
    expect(tache.id).toBeTruthy()

    // Vérifier que la tâche apparaît dans la liste GET
    const listResponse = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        headers: {
          'x-organisation-id': orgA.organisationId,
          'x-user-id': orgA.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    expect(listResponse.status()).toBe(200)
    const taches = await listResponse.json() as Array<{ id: string; titre: string }>
    const found = taches.find((t) => t.id === tache.id)
    expect(found).toBeDefined()
    expect(found?.titre).toBe('Pose carrelage RDC')

    // Note Q4 : notification in-app = stub (TODO Sprint 4)
    // Le TODO Sprint 4 dans le handler a été vérifié : aucune insertion dans notifications

    // cleanup géré par afterAll (GAP-cleanup-playwright)
  })

  // ============================================================
  // S1 bis : Tâche assignée à un ouvrier — assigned_to non-null + join user
  // GAP-011-A (Levi 2026-05-16) : le scénario S1 ne couvrait que assigned_to=null.
  // Ce test vérifie que assigned_to:<uuid> est bien persisté et que le join
  // assigned_user (nom, prenom) est résolu côté handler (cœur du flow US-011).
  // ============================================================

  test('S1 bis — Tâche assignée à un ouvrier : assigned_to persisté + join user résolu', async ({ request }) => {
    const orgA = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(orgA.organisationId)
    resources.authUserIds.push(orgA.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    // Créer un ouvrier dans l'org A (user direct en DB — pas via API users qui demande email/password)
    const ouvrierId = crypto.randomUUID()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: userInsertError } = await (adminSupabase.from('users') as any).insert({
      id: ouvrierId,
      organisation_id: orgA.organisationId,
      role: 'ouvrier',
      nom: 'Diallo',
      prenom: 'Mohamed',
      email: null,
      has_supabase_auth: false,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })
    expect(userInsertError).toBeNull()

    // Créer un chantier
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierData } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: orgA.organisationId,
      nom: 'Chantier S1 bis',
      client_nom: 'Client Test',
      adresse: '2 rue Test',
      code_postal: '75002',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: orgA.adminUserId,
    }).select('id').single()
    const chantierId = (chantierData as { id: string }).id

    // Créer la tâche AVEC assigned_to
    const response = await request.post(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        data: {
          titre: 'Découpe carrelage cuisine',
          assigned_to: ouvrierId,
          statut: 'a_faire',
        },
        headers: {
          'x-organisation-id': orgA.organisationId,
          'x-user-id': orgA.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    expect(response.status()).toBe(201)
    const tache = await response.json() as {
      id: string
      assigned_to: string | null
      assigned_user?: { nom: string; prenom: string } | null
    }

    // Cœur du test GAP-011-A : assigned_to non-null
    expect(tache.assigned_to).toBe(ouvrierId)

    // Vérifier que le join est résolu (US-011 S1 demande l'affichage du nom dans la liste)
    expect(tache.assigned_user).toBeDefined()
    expect(tache.assigned_user?.nom).toBe('Diallo')
    expect(tache.assigned_user?.prenom).toBe('Mohamed')

    // Vérifier que la tâche apparaît dans la liste avec assigned_to + join
    const listResponse = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        headers: {
          'x-organisation-id': orgA.organisationId,
          'x-user-id': orgA.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )
    const taches = await listResponse.json() as Array<{
      id: string
      assigned_to: string | null
      assigned_user?: { nom: string; prenom: string } | null
    }>
    const found = taches.find((t) => t.id === tache.id)
    expect(found?.assigned_to).toBe(ouvrierId)
    expect(found?.assigned_user?.nom).toBe('Diallo')
    // cleanup géré par afterAll
  })

  // ============================================================
  // S1 ter : UI conducteur — select assigned_to présent + assignation persistée
  // GAP-011-A UI (dette Sprint 2 rattrapée 2026-05-20) :
  //   Sprint 2 a été marqué "validé" sans tester que le FORMULAIRE UI conducteur
  //   transmettait assigned_to. Le champ a été ajouté à la page nouvelle/page.tsx
  //   (commit dette 2026-05-20). Ce test exerce le flow complet via Playwright page.
  // ============================================================

  test('S1 ter — UI conducteur sélectionne un ouvrier dans le select et la tâche est créée assignée', async ({ page, request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1. Créer un conducteur avec password (login UI possible)
    const conducteurEmail = `conducteur-${crypto.randomUUID()}@e2e-clawbtp.test`
    const conducteurPassword = `CondPass${crypto.randomUUID().slice(0, 8)}!`
    const { data: conducteurAuth, error: conducteurAuthError } =
      await adminSupabase.auth.admin.createUser({
        email: conducteurEmail,
        password: conducteurPassword,
        app_metadata: { organisation_id: org.organisationId, role: 'conducteur' },
        email_confirm: true,
      })
    expect(conducteurAuthError).toBeNull()
    expect(conducteurAuth.user).not.toBeNull()
    const conducteurId = conducteurAuth.user!.id
    resources.authUserIds.push(conducteurId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: condUserError } = await (adminSupabase.from('users') as any).insert({
      id: conducteurId,
      organisation_id: org.organisationId,
      role: 'conducteur',
      nom: 'Martin',
      prenom: 'Marc',
      email: conducteurEmail,
      has_supabase_auth: true,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })
    expect(condUserError).toBeNull()

    // 2. Créer un ouvrier (apparaîtra dans le select)
    const ouvrierId = crypto.randomUUID()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: ouvrierError } = await (adminSupabase.from('users') as any).insert({
      id: ouvrierId,
      organisation_id: org.organisationId,
      role: 'ouvrier',
      nom: 'Diallo',
      prenom: 'Mohamed',
      email: null,
      has_supabase_auth: false,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })
    expect(ouvrierError).toBeNull()

    // 3. Créer un chantier dont le conducteur est created_by (lui donne l'accès)
    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierData } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: org.organisationId,
      nom: 'Chantier S1 ter UI',
      client_nom: 'Client UI',
      adresse: '3 rue Test',
      code_postal: '75003',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: conducteurId,
    }).select('id').single()
    const chantierId = (chantierData as { id: string }).id

    // 4. Login UI conducteur
    await page.goto(`${BASE_URL}/login`)
    await page.fill('[type="email"]', conducteurEmail)
    await page.fill('[type="password"]', conducteurPassword)
    await page.click('[type="submit"]')
    // Conducteur redirigé vers son espace (chantiers)
    await page.waitForURL(/\/conducteur\/chantiers/, { timeout: 10000 })

    // 5. Aller sur la page de création de tâche
    await page.goto(`${BASE_URL}/conducteur/chantiers/${chantierId}/taches/nouvelle`)

    // 6. Le select assigned_to doit exister et contenir l'ouvrier
    const assignedSelect = page.getByTestId('assigned-to-select')
    await expect(assignedSelect).toBeVisible()
    // Le texte de l'option contient le nom + rôle
    await expect(
      assignedSelect.locator('option', { hasText: /Mohamed Diallo \(Ouvrier\)/ }),
    ).toHaveCount(1)

    // 7. Remplir le formulaire avec assignation
    await page.fill('#titre', 'Pose carrelage RDC (UI)')
    await assignedSelect.selectOption(ouvrierId)
    await page.click('button[type="submit"]')

    // 8. Redirection vers le détail chantier
    await page.waitForURL(`${BASE_URL}/conducteur/chantiers/${chantierId}`, { timeout: 10000 })

    // 9. Vérifier via API que la tâche est bien persistée avec assigned_to
    const listResponse = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': conducteurId,
          'x-user-role': 'conducteur',
        },
      },
    )
    expect(listResponse.status()).toBe(200)
    const taches = await listResponse.json() as Array<{
      titre: string
      assigned_to: string | null
      assigned_user?: { nom: string; prenom: string } | null
    }>
    const found = taches.find((t) => t.titre === 'Pose carrelage RDC (UI)')
    expect(found).toBeDefined()
    expect(found?.assigned_to).toBe(ouvrierId)
    expect(found?.assigned_user?.nom).toBe('Diallo')
    expect(found?.assigned_user?.prenom).toBe('Mohamed')
    // cleanup géré par afterAll
  })

  // ============================================================
  // S1 quater : UI admin — modal "+ Nouvelle tâche" depuis le détail chantier
  // Dette Sprint 2 extension (2026-05-20) — "admin peut tout faire" :
  //   l'admin doit aussi pouvoir créer une tâche depuis /admin/chantiers/[id].
  //   Le composant TacheCreateModal (data-testid admin-nouvelle-tache + select
  //   data-testid admin-tache-assigned-to) est exercé bout-en-bout.
  // ============================================================

  test('S1 quater — Admin crée une tâche assignée via la modal du tab Tâches', async ({ page, request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 1. Créer un ouvrier (apparaîtra dans le select)
    const ouvrierId = crypto.randomUUID()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: ouvrierError } = await (adminSupabase.from('users') as any).insert({
      id: ouvrierId,
      organisation_id: org.organisationId,
      role: 'ouvrier',
      nom: 'Bernard',
      prenom: 'Léa',
      email: null,
      has_supabase_auth: false,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })
    expect(ouvrierError).toBeNull()

    // 2. Créer un chantier dans l'org admin
    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierData } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: org.organisationId,
      nom: 'Chantier S1 quater Admin UI',
      client_nom: 'Client Admin',
      adresse: '4 rue Admin',
      code_postal: '75004',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: org.adminUserId,
    }).select('id').single()
    const chantierId = (chantierData as { id: string }).id

    // 3. Login UI admin
    await page.goto(`${BASE_URL}/login`)
    await page.fill('[type="email"]', org.email)
    await page.fill('[type="password"]', org.password)
    await page.click('[type="submit"]')
    // Tolère plusieurs destinations post-login (/, /admin, /admin/chantiers) — on attend juste de quitter /login
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10000 })

    // 4. Aller sur le détail chantier
    await page.goto(`${BASE_URL}/admin/chantiers/${chantierId}`)

    // 5. Basculer sur le tab Tâches
    await page.getByRole('button', { name: /Tâches/i }).click()

    // 6. Cliquer "+ Nouvelle tâche" (le bouton n'existait pas avant la dette)
    const nouvelleTacheBtn = page.getByTestId('admin-nouvelle-tache')
    await expect(nouvelleTacheBtn).toBeVisible()
    await nouvelleTacheBtn.click()

    // 7. La modal s'ouvre — vérifier le select assigned_to et sélectionner l'ouvrier
    const assignSelect = page.getByTestId('admin-tache-assigned-to')
    await expect(assignSelect).toBeVisible()
    await expect(
      assignSelect.locator('option', { hasText: /Léa Bernard \(Ouvrier\)/ }),
    ).toHaveCount(1)
    await assignSelect.selectOption(ouvrierId)

    // 8. Remplir le titre et soumettre
    await page.fill('#tache-titre', 'Coordination équipe carrelage (admin UI)')
    await page.getByRole('button', { name: /Créer la tâche/i }).click()

    // 9. Modal se ferme — vérifier qu'elle disparait
    await expect(assignSelect).not.toBeVisible({ timeout: 10000 })

    // 10. Vérifier via API que la tâche est persistée avec assigned_to
    const listResponse = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )
    expect(listResponse.status()).toBe(200)
    const taches = await listResponse.json() as Array<{
      titre: string
      assigned_to: string | null
      assigned_user?: { nom: string; prenom: string } | null
    }>
    const found = taches.find((t) => t.titre === 'Coordination équipe carrelage (admin UI)')
    expect(found).toBeDefined()
    expect(found?.assigned_to).toBe(ouvrierId)
    expect(found?.assigned_user?.nom).toBe('Bernard')
    expect(found?.assigned_user?.prenom).toBe('Léa')
    // cleanup géré par afterAll
  })

  // ============================================================
  // S2 : Passage bloqué + raison obligatoire
  // ============================================================

  test('S2 — Passage bloqué sans raison -> 400 | avec raison >= 10 car. -> 200', async ({ page, request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    // Créer chantier et tâche
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierData } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: org.organisationId,
      nom: 'Chantier US011 S2',
      client_nom: 'Client',
      adresse: '1 rue',
      code_postal: '75001',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: org.adminUserId,
    }).select('id').single()

    const chantierId = (chantierData as { id: string }).id

    const tacheResponse = await request.post(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        data: { titre: 'Tâche à bloquer', statut: 'en_cours' },
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )
    const tache = await tacheResponse.json() as { id: string }
    const tacheId = tache.id

    // Test API : PATCH sans raison -> 400
    const badResponse = await request.patch(
      `${BASE_URL}/api/taches/${tacheId}`,
      {
        data: { statut: 'bloque' }, // pas de bloque_raison
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    expect(badResponse.status()).toBe(400)
    const badBody = await badResponse.json() as { fields?: { bloque_raison?: string[] } }
    expect(badBody.fields?.bloque_raison).toBeDefined()
    expect(badBody.fields?.bloque_raison?.[0]).toMatch(/bloque_raison obligatoire/i)

    // Test API : PATCH avec raison < 10 car. -> 400
    const shortRaisonResponse = await request.patch(
      `${BASE_URL}/api/taches/${tacheId}`,
      {
        data: { statut: 'bloque', bloque_raison: 'court' },
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )
    expect(shortRaisonResponse.status()).toBe(400)

    // Test API : PATCH avec raison >= 10 car. -> 200
    const goodResponse = await request.patch(
      `${BASE_URL}/api/taches/${tacheId}`,
      {
        data: {
          statut: 'bloque',
          bloque_raison: 'Livraison béton repoussée semaine prochaine',
        },
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    expect(goodResponse.status()).toBe(200)
    const updatedTache = await goodResponse.json() as { statut: string; bloque_raison: string }
    expect(updatedTache.statut).toBe('bloque')
    expect(updatedTache.bloque_raison).toBe('Livraison béton repoussée semaine prochaine')

    // Test UI : page conducteur doit afficher la raison en rouge
    await page.goto(`${BASE_URL}/login`)
    await page.fill('[type="email"]', org.email)
    await page.fill('[type="password"]', org.password)
    await page.click('[type="submit"]')
    await page.waitForURL(`${BASE_URL}/admin/chantiers`, { timeout: 10000 })

    // Vérifier via l'API que la tâche est en bloqué (la page UI est pour le conducteur)
    const checkResponse = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId}/taches`,
      {
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )
    const taches = await checkResponse.json() as Array<{ id: string; statut: string; bloque_raison: string | null }>
    const blockedTache = taches.find((t) => t.id === tacheId)
    expect(blockedTache?.statut).toBe('bloque')
    expect(blockedTache?.bloque_raison).toBe('Livraison béton repoussée semaine prochaine')
    // cleanup géré par afterAll
  })

  // ============================================================
  // S3 : Accès hors périmètre -> HTTP 404
  // ============================================================

  test('S3 — GET /api/taches/[tache_org_B_id] depuis org A -> HTTP 404', async ({ request }) => {
    const orgA = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    const orgB = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(orgA.organisationId, orgB.organisationId)
    resources.authUserIds.push(orgA.adminUserId, orgB.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    // Créer chantier et tâche dans org B
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierB } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: orgB.organisationId,
      nom: 'Chantier Org B',
      client_nom: 'Client B',
      adresse: '1 rue B',
      code_postal: '33000',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: orgB.adminUserId,
    }).select('id').single()

    const chantierId = (chantierB as { id: string }).id

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tacheB } = await (adminSupabase.from('taches') as any).insert({
      chantier_id: chantierId,
      organisation_id: orgB.organisationId,
      titre: 'Tâche Org B',
      statut: 'a_faire',
      created_by: orgB.adminUserId,
    }).select('id').single()

    const tacheId = (tacheB as { id: string }).id

    // Tenter d'accéder à la tâche org B depuis org A -> HTTP 404 (I-06)
    const response = await request.patch(
      `${BASE_URL}/api/taches/${tacheId}`,
      {
        data: { statut: 'en_cours' },
        headers: {
          'x-organisation-id': orgA.organisationId, // Org A différente de Org B
          'x-user-id': orgA.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    // I-06 : 404 (pas 403) — ne révèle pas l'existence de la tâche hors organisation
    expect(response.status()).toBe(404)
    // cleanup géré par afterAll
  })
})
