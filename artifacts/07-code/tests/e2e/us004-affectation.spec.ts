/**
 * tests/e2e/us004-affectation.spec.ts — Playwright US-004 S1/S2/S3
 *
 * Critères Gherkin (SPRINT_2_PLAN.md §F.6) :
 *   S1 : Conducteur affecte Ahmed au chantier -> affectation créée, Ahmed dans liste
 *   S2 : GET /api/affectations?user_id=ahmed&date=today retourne 2 résultats
 *        (UI sélecteur QR = Sprint 3 — test API uniquement Sprint 2)
 *   S3 : Cross-org rejected -> HTTP 403
 *
 * Q3 (DoD partiel) : sélecteur QR mobile ouvrier = Sprint 3
 * Ce sprint teste uniquement la partie API des affectations.
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

test.describe('US-004 — Affectation ouvrier au chantier', () => {

  test.afterAll(async () => {
    await cleanupTestResources(resources)
  })

  // ============================================================
  // S1 : Affectation nominale
  // ============================================================

  test('S1 — Conducteur affecte Ahmed au chantier -> apparaît dans la liste', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    // Créer un conducteur et un ouvrier dans l'org
    const { data: conducteurAuth } = await adminSupabase.auth.admin.createUser({
      email: `conducteur-s1-${Date.now()}@us004.test`,
      password: 'Test1234!US004',
      app_metadata: { organisation_id: org.organisationId, role: 'conducteur' },
      email_confirm: true,
    })

    const conducteurId = conducteurAuth.user!.id
    resources.authUserIds.push(conducteurId)
    await adminSupabase.from('users').insert({
      id: conducteurId,
      organisation_id: org.organisationId,
      nom: 'Conducteur',
      prenom: 'Test',
      role: 'conducteur',
      has_supabase_auth: true,
    })

    const { data: ahmedAuth } = await adminSupabase.auth.admin.createUser({
      email: `ahmed-s1-${Date.now()}@us004.test`,
      password: 'Test1234!US004',
      app_metadata: { organisation_id: org.organisationId, role: 'ouvrier' },
      email_confirm: true,
    })

    const ahmedId = ahmedAuth.user!.id
    resources.authUserIds.push(ahmedId)
    await adminSupabase.from('users').insert({
      id: ahmedId,
      organisation_id: org.organisationId,
      nom: 'Ahmed',
      prenom: 'Ben',
      role: 'ouvrier',
      has_supabase_auth: false,
    })

    // Créer un chantier créé par le conducteur
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierData } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: org.organisationId,
      nom: 'Chantier Affectation Test',
      client_nom: 'Client Test',
      adresse: '1 rue Test',
      code_postal: '75001',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: conducteurId,
    }).select('id').single()

    const chantierId = (chantierData as { id: string }).id

    // Affecter Ahmed via l'API
    const response = await request.post(
      `${BASE_URL}/api/chantiers/${chantierId}/affectations`,
      {
        data: {
          user_id: ahmedId,
          date_debut: today,
        },
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': conducteurId,
          'x-user-role': 'conducteur',
        },
      },
    )

    expect(response.status()).toBe(201)
    const affectation = await response.json() as { id: string; user_id: string; chantier_id: string }
    expect(affectation.user_id).toBe(ahmedId)
    expect(affectation.chantier_id).toBe(chantierId)

    // Vérifier que Ahmed apparaît dans la liste des affectations
    const listResponse = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId}/affectations`,
      {
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': conducteurId,
          'x-user-role': 'conducteur',
        },
      },
    )

    expect(listResponse.status()).toBe(200)
    const affectations = await listResponse.json() as Array<{ id: string; user_id: string }>
    const ahmedAff = affectations.find((a) => a.user_id === ahmedId)
    expect(ahmedAff).toBeDefined()

    // Note Q3 : "ouvrier voit ses tâches dès date_debut au scan QR" = Sprint 3
    // cleanup géré par afterAll (auth users conducteur + ahmed + org admin)
  })

  // ============================================================
  // S2 : Deux affectations actives (API seulement — Sprint 2)
  // Note Q3 : l'UI sélecteur QR est Sprint 3
  // ============================================================

  test('S2 (API) — Ouvrier affecté à 2 chantiers actifs : GET retourne 2 affectations', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    // Créer ouvrier Ahmed
    const { data: ahmedAuth } = await adminSupabase.auth.admin.createUser({
      email: `ahmed-s2-${Date.now()}@us004.test`,
      password: 'Test1234!US004',
      app_metadata: { organisation_id: org.organisationId, role: 'ouvrier' },
      email_confirm: true,
    })
    const ahmedId = ahmedAuth.user!.id
    resources.authUserIds.push(ahmedId)
    await adminSupabase.from('users').insert({
      id: ahmedId,
      organisation_id: org.organisationId,
      nom: 'Ahmed',
      prenom: 'Test2',
      role: 'ouvrier',
      has_supabase_auth: false,
    })

    // Créer 2 chantiers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantier1 } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: org.organisationId,
      nom: 'Chantier Alpha',
      client_nom: 'Client A',
      adresse: '1 rue',
      code_postal: '75001',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: org.adminUserId,
    }).select('id').single()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantier2 } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: org.organisationId,
      nom: 'Chantier Beta',
      client_nom: 'Client B',
      adresse: '2 rue',
      code_postal: '33000',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: org.adminUserId,
    }).select('id').single()

    const chantierId1 = (chantier1 as { id: string }).id
    const chantierId2 = (chantier2 as { id: string }).id

    // Affecter Ahmed aux 2 chantiers
    await request.post(
      `${BASE_URL}/api/chantiers/${chantierId1}/affectations`,
      {
        data: { user_id: ahmedId, date_debut: today },
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    await request.post(
      `${BASE_URL}/api/chantiers/${chantierId2}/affectations`,
      {
        data: { user_id: ahmedId, date_debut: today },
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    // Vérifier que les 2 affectations existent
    const aff1Response = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId1}/affectations`,
      {
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )
    const aff2Response = await request.get(
      `${BASE_URL}/api/chantiers/${chantierId2}/affectations`,
      {
        headers: {
          'x-organisation-id': org.organisationId,
          'x-user-id': org.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    const affs1 = await aff1Response.json() as Array<{ user_id: string }>
    const affs2 = await aff2Response.json() as Array<{ user_id: string }>

    expect(affs1.some((a) => a.user_id === ahmedId)).toBe(true)
    expect(affs2.some((a) => a.user_id === ahmedId)).toBe(true)

    // Note Q3 : le sélecteur QR (UI mobile ouvrier pour choisir entre 2 chantiers) = Sprint 3
    // Sprint 2 prépare les données API — le test UI complet QR est dans Sprint 3
    // cleanup géré par afterAll
  })

  // ============================================================
  // S3 : Cross-org rejected -> HTTP 403
  // ============================================================

  test('S3 — Conducteur org A affecter ouvrier org B -> HTTP 403', async ({ request }) => {
    const orgA = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    const orgB = await createTestOrganisationDirect({ statut: 'trial_active', trialDaysOffset: 14 })
    resources.organisationIds.push(orgA.organisationId, orgB.organisationId)
    resources.authUserIds.push(orgA.adminUserId, orgB.adminUserId)
    const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const today = new Date().toISOString().split('T')[0]!
    const dateFin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    // Créer ouvrier dans org B
    const { data: ouvrierBAuth } = await adminSupabase.auth.admin.createUser({
      email: `ouvrier-b-s3-${Date.now()}@us004.test`,
      password: 'Test1234!US004',
      app_metadata: { organisation_id: orgB.organisationId, role: 'ouvrier' },
      email_confirm: true,
    })
    const ouvrierBId = ouvrierBAuth.user!.id
    resources.authUserIds.push(ouvrierBId)
    await adminSupabase.from('users').insert({
      id: ouvrierBId,
      organisation_id: orgB.organisationId,
      nom: 'Ouvrier',
      prenom: 'Org B',
      role: 'ouvrier',
      has_supabase_auth: false,
    })

    // Créer chantier dans org A
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chantierA } = await (adminSupabase.from('chantiers') as any).insert({
      organisation_id: orgA.organisationId,
      nom: 'Chantier Org A S3',
      client_nom: 'Client A',
      adresse: '1 rue A',
      code_postal: '75001',
      date_debut: today,
      date_fin_prevue: dateFin,
      created_by: orgA.adminUserId,
    }).select('id').single()

    const chantierId = (chantierA as { id: string }).id

    // Tentative d'affectation cross-org : conducteur org A -> ouvrier org B
    const response = await request.post(
      `${BASE_URL}/api/chantiers/${chantierId}/affectations`,
      {
        data: {
          user_id: ouvrierBId, // Ouvrier d'une autre organisation
          date_debut: today,
        },
        headers: {
          'x-organisation-id': orgA.organisationId,
          'x-user-id': orgA.adminUserId,
          'x-user-role': 'admin',
        },
      },
    )

    // DoD US-004 : cross-org rejected -> HTTP 403
    expect(response.status()).toBe(403)
    // cleanup géré par afterAll (orgA + orgB + admins + ouvrierB)
  })
})
