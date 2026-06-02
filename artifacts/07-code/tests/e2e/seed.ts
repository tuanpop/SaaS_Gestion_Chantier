// tests/e2e/seed.ts
// Seed idempotent pour branche Supabase test (D-2.5-024, RG-E2E-002)
//
// IMPORTANT: Ne peut être exécuté qu'après Tanjiro étape 2 (F003 levée)
// Ne pas appeler npm run test:e2e avant que SUPABASE_TEST_URL soit configuré.
//
// SECURITY: K2.5-CR-01 — Zéro console.log(process.env.*) dans ce fichier
// SECURITY: K2.5-T-11 — Whitelist tables (pas de TRUNCATE arbitraire)
// SECURITY: K2.5-T-12 — Emails seed domaine @e2e.local uniquement
// SECURITY: K2.5-T-02 — Guards anti-prod en tête de fichier

import { createClient } from '@supabase/supabase-js'

// ============================================================
// Guards anti-prod OBLIGATOIRES (K2.5-T-02, K2.5-E-06)
// ============================================================

// Guard 1 : SUPABASE_TEST_URL présente
const url = process.env.SUPABASE_TEST_URL
if (!url) throw new Error('SUPABASE_TEST_URL manquante dans .env.test')

// Guard 2 : pas le project-ref prod (si variable disponible)
const prodRef = process.env.SUPABASE_PROD_PROJECT_REF
if (prodRef && url.includes(prodRef)) throw new Error('SEED INTERDIT — URL cible prod')

// Guard 3 : pattern Supabase attendu
if (!url.includes('.supabase.co')) throw new Error('SUPABASE_TEST_URL inattendue — abort')

// Guard 4 : différent de SUPABASE_URL prod
if (process.env.NEXT_PUBLIC_SUPABASE_URL && url === process.env.NEXT_PUBLIC_SUPABASE_URL)
  throw new Error('SUPABASE_TEST_URL === NEXT_PUBLIC_SUPABASE_URL — abort')

const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY
if (!serviceKey) throw new Error('SUPABASE_TEST_SERVICE_KEY manquante dans .env.test')

// ============================================================
// Whitelist tables (K2.5-T-11 — TRUNCATE limité à ces tables)
// ============================================================

const TABLES = ['affectations', 'taches', 'photos', 'chantiers', 'users'] as const

// ============================================================
// Emails seed — domaine @e2e.local obligatoire (K2.5-T-12)
// ============================================================

const SEED_ADMIN_EMAIL = 'admin@e2e.local'
const SEED_CONDUCTEUR_EMAIL = 'conducteur@e2e.local'

function assertE2EEmail(email: string): void {
  if (!email.endsWith('@e2e.local')) {
    throw new Error(`deleteUser interdit sur domaine non-e2e.local : ${email}`)
  }
}

// ============================================================
// Client Supabase admin (service role)
// ============================================================

function createTestAdminClient() {
  return createClient(url!, serviceKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// ============================================================
// Helpers
// ============================================================

async function deleteTestUser(client: ReturnType<typeof createTestAdminClient>, email: string) {
  assertE2EEmail(email)

  // Chercher l'utilisateur par email dans auth.users
  const { data: userList } = await client.auth.admin.listUsers()
  const user = userList?.users?.find((u) => u.email === email)
  if (user) {
    await client.auth.admin.deleteUser(user.id)
  }
}

// ============================================================
// Reset (TRUNCATE whitelist seulement)
// ============================================================

async function resetTables(client: ReturnType<typeof createTestAdminClient>) {
  // Supprimer dans l'ordre des FK (affectations avant chantiers, etc.)
  for (const table of [...TABLES].reverse()) {
    // Seules les tables de la whitelist — SECURITY: K2.5-T-11
    const { error } = await client.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) {
      // Table peut ne pas exister en test branch — non fatal
    }
  }

  // Supprimer les users auth e2e
  await deleteTestUser(client, SEED_ADMIN_EMAIL)
  await deleteTestUser(client, SEED_CONDUCTEUR_EMAIL)
}

// ============================================================
// Seed principal (RG-E2E-002)
// Données minimales : 1 org, 1 admin, 1 conducteur, 1 ouvrier,
//                     1 chantier actif, 1 chantier archivé, 1 tâche, 1 affectation
// ============================================================

export async function resetAndSeed(): Promise<{
  orgId: string
  adminId: string
  conducteurId: string
  ouvrierUserId: string
  chantierId: string
  chantierArchiveId: string
  tacheId: string
  affectationId: string
}> {
  const client = createTestAdminClient()

  // Reset
  await resetTables(client)

  // 1. Créer l'organisation de test
  const { data: org, error: orgErr } = await client
    .from('organisations')
    .insert({
      nom: 'Test Org E2E',
      statut: 'trial_active',
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single()

  if (orgErr || !org) throw new Error(`Seed: création org échouée: ${orgErr?.message}`)
  const orgId = org.id as string

  // 2. Créer l'admin Supabase Auth
  const { data: adminAuthData, error: adminAuthErr } = await client.auth.admin.createUser({
    email: SEED_ADMIN_EMAIL,
    password: 'AdminE2E@test123!',
    email_confirm: true,
    app_metadata: { role: 'admin', organisation_id: orgId },
  })
  if (adminAuthErr || !adminAuthData.user) throw new Error(`Seed: création admin auth: ${adminAuthErr?.message}`)
  const adminAuthId = adminAuthData.user.id

  // 3. Créer le row admin dans public.users
  const { data: adminUser, error: adminUserErr } = await client
    .from('users')
    .insert({
      id: adminAuthId,
      organisation_id: orgId,
      role: 'admin',
      prenom: 'Admin',
      nom: 'E2E',
      email: SEED_ADMIN_EMAIL,
      has_supabase_auth: true,
      invitation_status: 'active',
    })
    .select('id')
    .single()
  if (adminUserErr || !adminUser) throw new Error(`Seed: création user admin: ${adminUserErr?.message}`)
  const adminId = adminUser.id as string

  // 4. Créer le conducteur Supabase Auth
  const { data: condAuthData, error: condAuthErr } = await client.auth.admin.createUser({
    email: SEED_CONDUCTEUR_EMAIL,
    password: 'ConducteurE2E@test123!',
    email_confirm: true,
    app_metadata: { role: 'conducteur', organisation_id: orgId },
  })
  if (condAuthErr || !condAuthData.user) throw new Error(`Seed: création conducteur auth: ${condAuthErr?.message}`)
  const condAuthId = condAuthData.user.id

  // 5. Créer le row conducteur dans public.users
  const { data: condUser, error: condUserErr } = await client
    .from('users')
    .insert({
      id: condAuthId,
      organisation_id: orgId,
      role: 'conducteur',
      prenom: 'Conducteur',
      nom: 'E2E',
      email: SEED_CONDUCTEUR_EMAIL,
      has_supabase_auth: true,
      invitation_status: 'active',
    })
    .select('id')
    .single()
  if (condUserErr || !condUser) throw new Error(`Seed: création user conducteur: ${condUserErr?.message}`)
  const conducteurId = condUser.id as string

  // 6. Créer un ouvrier sans email
  const { data: ouvrier, error: ouvrierErr } = await client
    .from('users')
    .insert({
      organisation_id: orgId,
      role: 'ouvrier',
      prenom: 'Ouvrier',
      nom: 'E2E',
      has_supabase_auth: false,
    })
    .select('id')
    .single()
  if (ouvrierErr || !ouvrier) throw new Error(`Seed: création ouvrier: ${ouvrierErr?.message}`)
  const ouvrierUserId = ouvrier.id as string

  // 7. Créer 1 chantier actif
  const { data: chantier, error: chantierErr } = await client
    .from('chantiers')
    .insert({
      organisation_id: orgId,
      created_by: adminId,
      nom: 'Chantier E2E Actif',
      client_nom: 'Client Test',
      adresse: '1 rue du Test',
      code_postal: '75001',
      statut: 'actif',
      date_debut: '2026-01-01',
      date_fin_prevue: '2026-12-31',
      budget_alloue: 100000,
      budget_depense: 0,
    })
    .select('id')
    .single()
  if (chantierErr || !chantier) throw new Error(`Seed: création chantier: ${chantierErr?.message}`)
  const chantierId = chantier.id as string

  // 8. Créer 1 chantier archivé
  const { data: chantierArchive, error: archErr } = await client
    .from('chantiers')
    .insert({
      organisation_id: orgId,
      created_by: adminId,
      nom: 'Chantier E2E Archivé',
      client_nom: 'Client Archivé',
      adresse: '2 rue Archivée',
      code_postal: '75002',
      statut: 'archive',
      date_debut: '2025-01-01',
      date_fin_prevue: '2025-06-30',
      budget_alloue: 50000,
      budget_depense: 50000,
    })
    .select('id')
    .single()
  if (archErr || !chantierArchive) throw new Error(`Seed: création chantier archivé: ${archErr?.message}`)
  const chantierArchiveId = chantierArchive.id as string

  // 9. Créer 1 tâche sur le chantier actif
  const { data: tache, error: tacheErr } = await client
    .from('taches')
    .insert({
      organisation_id: orgId,
      chantier_id: chantierId,
      created_by: conducteurId,
      titre: 'Tâche E2E',
      statut: 'a_faire',
    })
    .select('id')
    .single()
  if (tacheErr || !tache) throw new Error(`Seed: création tâche: ${tacheErr?.message}`)
  const tacheId = tache.id as string

  // 10. Créer 1 affectation (conducteur sur chantier actif)
  const { data: affectation, error: affErr } = await client
    .from('affectations')
    .insert({
      organisation_id: orgId,
      chantier_id: chantierId,
      user_id: conducteurId,
      date_debut: '2026-01-01',
    })
    .select('id')
    .single()
  if (affErr || !affectation) throw new Error(`Seed: création affectation: ${affErr?.message}`)
  const affectationId = affectation.id as string

  return {
    orgId,
    adminId,
    conducteurId,
    ouvrierUserId,
    chantierId,
    chantierArchiveId,
    tacheId,
    affectationId,
  }
}
