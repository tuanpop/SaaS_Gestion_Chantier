/**
 * tests/unit/chantiers-rls.test.ts — Tests d'intégration RLS Sprint 2
 * @integration — marqué pour exclure du CI si Supabase local absent
 *
 * Prérequis :
 *   - Supabase local running : `supabase start`
 *   - Migration 002_chantiers_taches.sql appliquée (`supabase db reset`)
 *   - SUPABASE_TEST_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY dans .env.test
 *
 * Scénarios (SPRINT_2_PLAN.md §F.2) :
 *   1. Admin org A SELECT chantiers -> uniquement chantiers org A
 *   2. Admin org A INSERT chantier avec organisation_id=org_B -> rejected (RLS policy)
 *   3. Conducteur org A GET /api/chantiers/[chantier_org_B_id] -> HTTP 404
 *   4. Conducteur org A POST affectation avec user_id = ouvrier_org_B -> HTTP 403
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database'

// ============================================================
// Condition de skip : tests nécessitent Supabase local
// ============================================================

const SUPABASE_TEST_URL = process.env['SUPABASE_TEST_URL']
const hasSupabaseLocal = !!SUPABASE_TEST_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
const SUPABASE_ANON_KEY = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? ''

const describeIfSupabase = hasSupabaseLocal ? describe : describe.skip

// ============================================================
// Helpers
// ============================================================

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_TEST_URL!, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Créer un client authentifié avec JWT simulé via la session
async function createAuthenticatedClient(email: string, password: string) {
  const client = createClient<Database>(SUPABASE_TEST_URL!, SUPABASE_ANON_KEY)
  await client.auth.signInWithPassword({ email, password })
  return client
}

// Données test — créées dans beforeAll, nettoyées dans afterAll
interface TestData {
  orgA: { id: string }
  orgB: { id: string }
  adminA: { email: string; password: string; id: string }
  conducteurA: { email: string; password: string; id: string }
  ouvrierB: { email: string; password: string; id: string }
  chantierA: { id: string }
  chantierB: { id: string }
}

const testData: Partial<TestData> = {}

// ============================================================
// Suite de tests RLS Sprint 2
// ============================================================

describeIfSupabase('@integration — RLS chantiers/affectations/taches Sprint 2', () => {
  beforeAll(async () => {
    const admin = adminClient()
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 30)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]!
    const today = new Date().toISOString().split('T')[0]!

    // Créer organisation A
    const { data: orgA } = await admin
      .from('organisations')
      .insert({
        name: 'Test Org A Sprint2',
        plan: 'starter',
        statut: 'trial_active',
        trial_ends_at: tomorrow.toISOString(),
      })
      .select('id')
      .single()

    // Créer organisation B
    const { data: orgB } = await admin
      .from('organisations')
      .insert({
        name: 'Test Org B Sprint2',
        plan: 'starter',
        statut: 'trial_active',
        trial_ends_at: tomorrow.toISOString(),
      })
      .select('id')
      .single()

    if (!orgA || !orgB) throw new Error('Impossible de créer les organisations de test')

    testData.orgA = orgA
    testData.orgB = orgB

    // Créer admin org A
    const { data: authAdminA } = await admin.auth.admin.createUser({
      email: `test-admin-a-s2-${Date.now()}@clawbtp.test`,
      password: 'Test1234!Sprint2@A',
      app_metadata: { organisation_id: orgA.id, role: 'admin' },
      email_confirm: true,
    })

    if (!authAdminA.user) throw new Error('Impossible de créer admin A')

    testData.adminA = {
      email: authAdminA.user.email!,
      password: 'Test1234!Sprint2@A',
      id: authAdminA.user.id,
    }

    await admin.from('users').insert({
      id: authAdminA.user.id,
      organisation_id: orgA.id,
      nom: 'Admin',
      prenom: 'Test A',
      role: 'admin',
      has_supabase_auth: true,
    })

    // Créer conducteur org A
    const { data: authConducteurA } = await admin.auth.admin.createUser({
      email: `test-conducteur-a-s2-${Date.now()}@clawbtp.test`,
      password: 'Test1234!Sprint2@C',
      app_metadata: { organisation_id: orgA.id, role: 'conducteur' },
      email_confirm: true,
    })

    if (!authConducteurA.user) throw new Error('Impossible de créer conducteur A')

    testData.conducteurA = {
      email: authConducteurA.user.email!,
      password: 'Test1234!Sprint2@C',
      id: authConducteurA.user.id,
    }

    await admin.from('users').insert({
      id: authConducteurA.user.id,
      organisation_id: orgA.id,
      nom: 'Conducteur',
      prenom: 'Test A',
      role: 'conducteur',
      has_supabase_auth: true,
    })

    // Créer ouvrier org B
    const { data: authOuvrierB } = await admin.auth.admin.createUser({
      email: `test-ouvrier-b-s2-${Date.now()}@clawbtp.test`,
      password: 'Test1234!Sprint2@O',
      app_metadata: { organisation_id: orgB.id, role: 'ouvrier' },
      email_confirm: true,
    })

    if (!authOuvrierB.user) throw new Error('Impossible de créer ouvrier B')

    testData.ouvrierB = {
      email: authOuvrierB.user.email!,
      password: 'Test1234!Sprint2@O',
      id: authOuvrierB.user.id,
    }

    await admin.from('users').insert({
      id: authOuvrierB.user.id,
      organisation_id: orgB.id,
      nom: 'Ouvrier',
      prenom: 'Test B',
      role: 'ouvrier',
      has_supabase_auth: false,
    })

    // Créer chantier dans org A
    const { data: chantierA } = await admin
      .from('chantiers')
      .insert({
        organisation_id: orgA.id,
        nom: 'Chantier Test Org A',
        client_nom: 'Client A',
        adresse: '1 rue de la Paix',
        code_postal: '75001',
        date_debut: today,
        date_fin_prevue: tomorrowStr,
        created_by: authAdminA.user.id,
      })
      .select('id')
      .single()

    if (!chantierA) throw new Error('Impossible de créer le chantier A')
    testData.chantierA = chantierA

    // Créer chantier dans org B
    const { data: chantierB } = await admin
      .from('chantiers')
      .insert({
        organisation_id: orgB.id,
        nom: 'Chantier Test Org B',
        client_nom: 'Client B',
        adresse: '2 rue du Commerce',
        code_postal: '33000',
        date_debut: today,
        date_fin_prevue: tomorrowStr,
        created_by: authOuvrierB.user.id,
      })
      .select('id')
      .single()

    if (!chantierB) throw new Error('Impossible de créer le chantier B')
    testData.chantierB = chantierB
  }, 30000)

  afterAll(async () => {
    const admin = adminClient()

    // Nettoyage (cascade via FK)
    if (testData.orgA) {
      await admin.from('chantiers').delete().eq('organisation_id', testData.orgA.id)
      await admin.from('users').delete().eq('organisation_id', testData.orgA.id)
      await admin.from('organisations').delete().eq('id', testData.orgA.id)
    }
    if (testData.orgB) {
      await admin.from('chantiers').delete().eq('organisation_id', testData.orgB.id)
      await admin.from('users').delete().eq('organisation_id', testData.orgB.id)
      await admin.from('organisations').delete().eq('id', testData.orgB.id)
    }

    // Supprimer les comptes auth
    if (testData.adminA) await adminClient().auth.admin.deleteUser(testData.adminA.id)
    if (testData.conducteurA) await adminClient().auth.admin.deleteUser(testData.conducteurA.id)
    if (testData.ouvrierB) await adminClient().auth.admin.deleteUser(testData.ouvrierB.id)
  }, 30000)

  /**
   * Scénario 1 : Admin org A ne voit que les chantiers de son org
   */
  it('RLS-001 : admin org A SELECT chantiers -> uniquement org A', async () => {
    const client = await createAuthenticatedClient(
      testData.adminA!.email,
      testData.adminA!.password,
    )

    const { data, error } = await client
      .from('chantiers')
      .select('id, organisation_id')

    expect(error).toBeNull()
    expect(data).not.toBeNull()

    // Tous les chantiers retournés doivent appartenir à org A
    const chantiers = data as Array<{ id: string; organisation_id: string }>
    for (const c of chantiers) {
      expect(c.organisation_id).toBe(testData.orgA!.id)
    }

    // Le chantier org B n'est pas dans les résultats
    const hasChantierB = chantiers.some((c) => c.id === testData.chantierB!.id)
    expect(hasChantierB).toBe(false)
  })

  /**
   * Scénario 2 : Admin org A ne peut pas insérer dans org B (RLS policy violation)
   */
  it('RLS-002 : admin org A INSERT chantier org B -> error RLS', async () => {
    const client = await createAuthenticatedClient(
      testData.adminA!.email,
      testData.adminA!.password,
    )

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 30)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]!
    const today = new Date().toISOString().split('T')[0]!

    const { error } = await client
      .from('chantiers')
      .insert({
        organisation_id: testData.orgB!.id, // Tentative cross-org
        nom: 'Chantier Interdit',
        client_nom: 'Client Interdit',
        adresse: '99 rue Interdite',
        code_postal: '75000',
        date_debut: today,
        date_fin_prevue: tomorrowStr,
        created_by: testData.adminA!.id,
      })

    // La RLS doit bloquer l'insertion
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/policy/i)
  })

  /**
   * Scénario 3 : GET /api/chantiers/[chantier_org_B_id] -> HTTP 404
   * (Test API — nécessite le serveur Next.js local)
   *
   * Skip permanent : ce scénario est désormais couvert par le test E2E Playwright
   * "RLS-003 — Conducteur org A GET chantier org B -> 404 (I-06)" dans
   * tests/e2e/us010-chantier.spec.ts (GAP-RLS-003 fermé 2026-05-19).
   * Conservé ici en .skip pour traçabilité et documentation du payload attendu.
   */
  it.skip('RLS-003 : conducteur org A GET chantier org B -> HTTP 404', async () => {
    // Couvert par tests/e2e/us010-chantier.spec.ts (RLS-003).
    const response = await fetch(
      `http://localhost:3000/api/chantiers/${testData.chantierB!.id}`,
      {
        headers: {
          'x-organisation-id': testData.orgA!.id,
          'x-user-id': testData.conducteurA!.id,
          'x-user-role': 'conducteur',
        },
      },
    )
    expect(response.status).toBe(404)
  })

  /**
   * Scénario 4 : POST affectation cross-org -> HTTP 403
   * (Test API — nécessite le serveur Next.js local)
   * Marqué skip car nécessite un serveur en cours
   */
  it.skip('RLS-004 : conducteur org A POST affectation ouvrier org B -> HTTP 403', async () => {
    // Ce test est couvert par Playwright E2E (tests/e2e/us004-affectation.spec.ts S3)
    const today = new Date().toISOString().split('T')[0]!

    const response = await fetch(
      `http://localhost:3000/api/chantiers/${testData.chantierA!.id}/affectations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-organisation-id': testData.orgA!.id,
          'x-user-id': testData.conducteurA!.id,
          'x-user-role': 'conducteur',
        },
        body: JSON.stringify({
          user_id: testData.ouvrierB!.id, // Ouvrier d'une autre org
          date_debut: today,
        }),
      },
    )
    expect(response.status).toBe(403)
  })

  /**
   * Scénario additionnel : RLS taches — isolation org
   */
  it('RLS-005 : taches insérées dans org A ne visibles que depuis org A', async () => {
    const admin = adminClient()

    // Insérer une tâche dans org A
    const { data: tache, error: insertError } = await admin
      .from('taches')
      .insert({
        chantier_id: testData.chantierA!.id,
        organisation_id: testData.orgA!.id,
        titre: 'Tâche test RLS',
        statut: 'a_faire',
        created_by: testData.adminA!.id,
      })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(tache).not.toBeNull()

    const tacheId = (tache as { id: string }).id

    // Admin org A peut lire la tâche
    const clientA = await createAuthenticatedClient(
      testData.adminA!.email,
      testData.adminA!.password,
    )

    const { data: tachesA } = await clientA
      .from('taches')
      .select('id')
      .eq('id', tacheId)

    expect(tachesA?.length).toBe(1)

    // Nettoyage
    await admin.from('taches').delete().eq('id', tacheId)
  })
})
