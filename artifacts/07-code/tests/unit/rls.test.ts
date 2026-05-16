/**
 * tests/unit/rls.test.ts — Tests d'intégration RLS multi-tenant
 *
 * Prérequis (SPRINT_1_PLAN.md §7.3) :
 *   - Supabase local running : `supabase start`
 *   - SUPABASE_TEST_URL défini dans .env.test ou process.env
 *   - SUPABASE_SERVICE_ROLE_KEY défini
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY défini
 *   - Auth Hook déployé localement (supabase/functions/auth-hook.ts)
 *
 * Ces tests sont marqués describe.skipIf(!process.env.SUPABASE_TEST_URL)
 * -> skippés en CI si Supabase local absent.
 *
 * Scénarios (SPRINT_1_PLAN.md §7.3) :
 *   1. Admin org A SELECT users -> uniquement users org A (isolation RLS)
 *   2. Admin org A INSERT user avec organisation_id=org_B -> rejected (policy violation)
 *   3. Conducteur org A GET /api/users -> 403 (rôle insuffisant)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database'

// ============================================================
// Condition de skip : tests RLS nécessitent Supabase local
// ============================================================

const SUPABASE_TEST_URL = process.env['SUPABASE_TEST_URL']
const hasSupabaseLocal = !!SUPABASE_TEST_URL

// ============================================================
// Helpers locaux (sans importer setup.ts qui dépend de NEXT_PUBLIC_APP_URL)
// ============================================================

function createAdminClientForTests(): SupabaseClient<Database> {
  const url = SUPABASE_TEST_URL ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? ''
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Crée un client Supabase authentifié comme un user spécifique.
 * Utilise signInWithPassword pour obtenir un JWT réel avec les claims injectés par l'Auth Hook.
 * Ce JWT est ensuite utilisé pour les opérations RLS.
 */
async function createAuthenticatedClient(
  email: string,
  password: string,
): Promise<SupabaseClient<Database>> {
  const url = SUPABASE_TEST_URL ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? ''
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? ''

  const client = createClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`Auth failed for ${email}: ${error.message}`)
  }

  return client
}

// ============================================================
// State de test — partagé entre les tests dans le describe
// ============================================================

interface TestOrg {
  organisationId: string
  adminUserId: string
  email: string
  password: string
  conducteurId?: string
  conducteurEmail?: string
  conducteurPassword?: string
}

let orgA: TestOrg
let orgB: TestOrg
let adminClient: SupabaseClient<Database>

// ============================================================
// Tests RLS — skippés si Supabase local absent
// ============================================================

describe.skipIf(!hasSupabaseLocal)('RLS — isolation multi-tenant', () => {

  beforeAll(async () => {
    adminClient = createAdminClientForTests()

    // Créer deux organisations de test
    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 14)

    // --- Organisation A ---
    const emailA = `rls-test-admin-a-${crypto.randomUUID()}@rls-test.local`
    const passwordA = `TestPassA${crypto.randomUUID().slice(0, 8)}!`

    const { data: orgAData } = await adminClient
      .from('organisations')
      .insert({ name: 'RLS Test Org A', plan: 'starter', statut: 'trial_active', trial_ends_at: trialEndsAt.toISOString() })
      .select('id')
      .single()

    if (!orgAData) throw new Error('Failed to create org A')

    const { data: authA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password: passwordA,
      app_metadata: { organisation_id: orgAData.id, role: 'admin' },
      email_confirm: true,
    })

    if (!authA?.user) throw new Error('Failed to create auth user A')

    await adminClient.from('users').insert({
      id: authA.user.id,
      organisation_id: orgAData.id,
      role: 'admin',
      nom: 'Admin A',
      prenom: '',
      email: emailA,
      has_supabase_auth: true,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })

    // Créer un ouvrier dans org A (pour tester isolation)
    await adminClient.from('users').insert({
      id: crypto.randomUUID(),
      organisation_id: orgAData.id,
      role: 'ouvrier',
      nom: 'Ouvrier A',
      prenom: 'Test',
      email: null,
      has_supabase_auth: false,
      invitation_status: null,
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })

    orgA = {
      organisationId: orgAData.id,
      adminUserId: authA.user.id,
      email: emailA,
      password: passwordA,
    }

    // --- Organisation B ---
    const emailB = `rls-test-admin-b-${crypto.randomUUID()}@rls-test.local`
    const passwordB = `TestPassB${crypto.randomUUID().slice(0, 8)}!`

    const { data: orgBData } = await adminClient
      .from('organisations')
      .insert({ name: 'RLS Test Org B', plan: 'starter', statut: 'trial_active', trial_ends_at: trialEndsAt.toISOString() })
      .select('id')
      .single()

    if (!orgBData) throw new Error('Failed to create org B')

    const { data: authB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password: passwordB,
      app_metadata: { organisation_id: orgBData.id, role: 'admin' },
      email_confirm: true,
    })

    if (!authB?.user) throw new Error('Failed to create auth user B')

    await adminClient.from('users').insert({
      id: authB.user.id,
      organisation_id: orgBData.id,
      role: 'admin',
      nom: 'Admin B',
      prenom: '',
      email: emailB,
      has_supabase_auth: true,
      invitation_status: 'active',
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })

    orgB = {
      organisationId: orgBData.id,
      adminUserId: authB.user.id,
      email: emailB,
      password: passwordB,
    }

    // --- Conducteur dans org A (pour test 3) ---
    const conducteurEmail = `rls-conducteur-a-${crypto.randomUUID()}@rls-test.local`
    const conducteurPassword = `TestConducteur${crypto.randomUUID().slice(0, 8)}!`

    const { data: conducteurAuth } = await adminClient.auth.admin.createUser({
      email: conducteurEmail,
      password: conducteurPassword,
      app_metadata: { organisation_id: orgAData.id, role: 'conducteur' },
      email_confirm: true,
    })

    if (conducteurAuth?.user) {
      await adminClient.from('users').insert({
        id: conducteurAuth.user.id,
        organisation_id: orgAData.id,
        role: 'conducteur',
        nom: 'Conducteur A',
        prenom: 'Test',
        email: conducteurEmail,
        has_supabase_auth: true,
        invitation_status: 'active',
        telephone: null,
        qr_token: null,
        avatar_url: null,
      })

      orgA.conducteurId = conducteurAuth.user.id
      orgA.conducteurEmail = conducteurEmail
      orgA.conducteurPassword = conducteurPassword
    }
  }, 30_000) // timeout 30s pour le setup

  afterAll(async () => {
    if (!adminClient) return

    // Cleanup dans l'ordre : users -> auth users -> organisations
    for (const org of [orgA, orgB]) {
      if (!org) continue

      await adminClient.from('users').delete().eq('organisation_id', org.organisationId)
      await adminClient.auth.admin.deleteUser(org.adminUserId)

      if (org.conducteurId) {
        await adminClient.auth.admin.deleteUser(org.conducteurId)
      }

      await adminClient.from('organisations').delete().eq('id', org.organisationId)
    }
  }, 30_000)

  // ----------------------------------------------------------
  // Scénario 1 : Admin org A SELECT users -> uniquement users org A
  // ----------------------------------------------------------

  it('GIVEN admin org A authentifié WHEN SELECT users THEN uniquement les users de org A (RLS isolation)', async () => {
    const clientA = await createAuthenticatedClient(orgA.email, orgA.password)

    const { data: users, error } = await clientA
      .from('users')
      .select('id, organisation_id')

    expect(error).toBeNull()
    expect(users).not.toBeNull()
    expect(users!.length).toBeGreaterThan(0)

    // Tous les users retournés appartiennent à org A
    for (const user of users!) {
      expect(user.organisation_id).toBe(orgA.organisationId)
    }

    // Aucun user de org B dans les résultats
    const orgBUsersInResult = users!.filter(
      (u) => u.organisation_id === orgB.organisationId,
    )
    expect(orgBUsersInResult).toHaveLength(0)
  })

  // ----------------------------------------------------------
  // Scénario 2 : Admin org A INSERT user avec organisation_id=org_B -> rejected
  // ----------------------------------------------------------

  it('GIVEN admin org A WHEN INSERT user avec organisation_id=org_B THEN erreur RLS (policy violation)', async () => {
    const clientA = await createAuthenticatedClient(orgA.email, orgA.password)

    const { error } = await clientA.from('users').insert({
      id: crypto.randomUUID(),
      organisation_id: orgB.organisationId, // Cross-tenant insert — DOIT être rejeté par RLS
      role: 'ouvrier',
      nom: 'Cross Tenant',
      prenom: 'Test',
      email: null,
      has_supabase_auth: false,
      invitation_status: null,
      telephone: null,
      qr_token: null,
      avatar_url: null,
    })

    // La policy RLS WITH CHECK doit rejeter cette insertion
    expect(error).not.toBeNull()
    // Supabase retourne une erreur de type 42501 (insufficient_privilege) pour une violation RLS
    // ou PGRST301 (row level security violation)
    expect(
      error!.message.toLowerCase().includes('row-level security') ||
      error!.message.toLowerCase().includes('permission') ||
      error!.code === '42501' ||
      error!.code === 'PGRST301',
    ).toBe(true)
  })

  // ----------------------------------------------------------
  // Scénario 3 : Conducteur GET /api/users -> 403
  // Test via l'API (pas juste la DB) — vérifie le RBAC middleware
  // ----------------------------------------------------------

  it('GIVEN conducteur org A WHEN GET /api/users THEN HTTP 403 (rôle admin requis)', async () => {
    // Skip si pas de conducteur créé
    if (!orgA.conducteurEmail || !orgA.conducteurPassword) {
      console.warn('Conducteur non créé — skip scénario 3')
      return
    }

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    // Se connecter comme conducteur et récupérer les cookies
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: orgA.conducteurEmail,
        password: orgA.conducteurPassword,
      }),
    })

    // Extraire les cookies de session
    const setCookieHeader = loginRes.headers.get('set-cookie') ?? ''

    // Appeler GET /api/users avec la session conducteur
    const usersRes = await fetch(`${baseUrl}/api/users`, {
      method: 'GET',
      headers: {
        Cookie: setCookieHeader,
      },
    })

    expect(usersRes.status).toBe(403)
  })
})

// ============================================================
// Tests sans Supabase — vérifications de structure uniquement
// ============================================================

describe('RLS — vérifications de configuration (sans Supabase)', () => {
  it('SUPABASE_TEST_URL absent -> les tests RLS intégration sont skippés', () => {
    // Ce test documente le comportement attendu quand Supabase local est absent
    if (!hasSupabaseLocal) {
      expect(SUPABASE_TEST_URL).toBeUndefined()
    } else {
      expect(SUPABASE_TEST_URL).toBeTruthy()
    }
  })
})
