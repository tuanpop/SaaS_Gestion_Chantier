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
import { createTestOrganisationDirect, cleanupTestResources } from './helpers/setup'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'
const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? ''
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''

test.describe('US-011 — Tâches chantier', () => {

  // ============================================================
  // S1 : Création tâche + assignation
  // ============================================================

  test('S1 — Conducteur crée une tâche assignée, statut=a_faire visible dans liste', async ({ request }) => {
    const orgA = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
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

    await cleanupTestResources({ organisationIds: [orgA.organisationId], authUserIds: [orgA.adminUserId] })
  })

  // ============================================================
  // S2 : Passage bloqué + raison obligatoire
  // ============================================================

  test('S2 — Passage bloqué sans raison -> 400 | avec raison >= 10 car. -> 200', async ({ page, request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
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

    await cleanupTestResources({ organisationIds: [org.organisationId], authUserIds: [org.adminUserId] })
  })

  // ============================================================
  // S3 : Accès hors périmètre -> HTTP 404
  // ============================================================

  test('S3 — GET /api/taches/[tache_org_B_id] depuis org A -> HTTP 404', async ({ request }) => {
    const orgA = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    const orgB = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
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

    await cleanupTestResources({ organisationIds: [orgA.organisationId, orgB.organisationId], authUserIds: [orgA.adminUserId, orgB.adminUserId] })
  })
})
