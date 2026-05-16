/**
 * tests/e2e/us003-invitation.spec.ts — Tests Playwright US-003
 *
 * Prérequis :
 *   - `supabase start` — Supabase local running
 *   - `npm run dev` — Next.js dev server running (port 3000 par défaut)
 *   - .env.local avec : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY, QR_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL
 *
 * Scénarios couverts (SPRINT_1_PLAN.md §Mapping US-003) :
 *   S1 : Invitation conducteur -> invitation_status='pending', magic link 48h
 *   S2 : Création ouvrier sans email -> has_supabase_auth=false, qr_token AES-256-GCM, QR PNG
 *   S3 : Renvoi invitation expirée -> invitation_status repassé à 'pending'
 *
 * Cleanup : afterAll supprime les ressources créées.
 */

import { test, expect, type APIRequestContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  createTestOrganisationDirect,
  cleanupTestResources,
  type CreatedResources,
} from './helpers/setup'
import type { Database } from '../../types/database'

// ============================================================
// State partagé
// ============================================================

const resources: CreatedResources = {
  organisationIds: [],
  authUserIds: [],
}

// ============================================================
// Helper : effectuer un login et retourner les headers Set-Cookie
// pour les réutiliser dans les appels API suivants
// ============================================================

async function getAuthenticatedSession(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

  const loginRes = await request.post(`${baseUrl}/api/auth/login`, {
    data: { email, password },
  })

  if (!loginRes.ok()) {
    const body = await loginRes.text()
    throw new Error(`Login failed (${loginRes.status()}): ${body}`)
  }
  // Playwright APIRequestContext gère les cookies automatiquement pour les appels suivants
}

// ============================================================
// Tests
// ============================================================

test.describe('US-003 — Inviter des collaborateurs', () => {

  test.afterAll(async () => {
    await cleanupTestResources(resources)
  })

  // ----------------------------------------------------------
  // S1 : Invitation conducteur
  // ----------------------------------------------------------

  test('S1 — Invitation conducteur : invitation_status=pending, has_supabase_auth=true', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    // Login admin
    await getAuthenticatedSession(request, org.email, org.password)

    const conducteurEmail = `conducteur-s1-${crypto.randomUUID()}@e2e-clawbtp.test`

    // POST /api/users — invitation conducteur
    const res = await request.post(`${baseUrl}/api/users`, {
      data: {
        role: 'conducteur',
        email: conducteurEmail,
        nom: 'Dupont',
        prenom: 'Jean',
      },
    })

    // HTTP 201 sur succès
    expect(res.status()).toBe(201)

    const body = await res.json() as {
      data: {
        user_id: string
        role: string
        invitation_status: string
      }
    }

    expect(body.data.role).toBe('conducteur')
    expect(body.data.invitation_status).toBe('pending')

    // Enregistrer l'ID pour cleanup
    resources.authUserIds.push(body.data.user_id)

    // Vérifier en DB que le conducteur a bien has_supabase_auth=true et invitation_status='pending'
    const adminSupabase = createClient<Database>(
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
      process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: conducteur } = await adminSupabase
      .from('users')
      .select('id, role, has_supabase_auth, invitation_status, email')
      .eq('id', body.data.user_id)
      .single()

    expect(conducteur).not.toBeNull()
    expect(conducteur!.role).toBe('conducteur')
    expect(conducteur!.has_supabase_auth).toBe(true)
    expect(conducteur!.invitation_status).toBe('pending')
    expect(conducteur!.email).toBe(conducteurEmail)
  })

  // ----------------------------------------------------------
  // S2 : Création ouvrier sans email + GET QR PNG
  // ----------------------------------------------------------

  test('S2 — Création ouvrier sans email : has_supabase_auth=false, QR PNG retourné', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    // Login admin
    await getAuthenticatedSession(request, org.email, org.password)

    // POST /api/users — création ouvrier sans email
    const createRes = await request.post(`${baseUrl}/api/users`, {
      data: {
        role: 'ouvrier',
        nom: 'Martin',
        prenom: 'Pierre',
        telephone: '0612345678',
      },
    })

    expect(createRes.status()).toBe(201)

    const createBody = await createRes.json() as {
      data: {
        user_id: string
        role: string
        has_supabase_auth: boolean
      }
    }

    expect(createBody.data.role).toBe('ouvrier')
    expect(createBody.data.has_supabase_auth).toBe(false)

    const ouvrierId = createBody.data.user_id
    // Ouvrier n'a pas de compte Supabase Auth -> pas d'auth user ID à nettoyer
    // (cleanup se fait via organisation_id dans cleanupTestResources)

    // Vérifier en DB
    const adminSupabase = createClient<Database>(
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
      process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: ouvrier } = await adminSupabase
      .from('users')
      .select('id, role, has_supabase_auth, invitation_status, email, qr_token')
      .eq('id', ouvrierId)
      .single()

    expect(ouvrier).not.toBeNull()
    expect(ouvrier!.role).toBe('ouvrier')
    expect(ouvrier!.has_supabase_auth).toBe(false)
    expect(ouvrier!.email).toBeNull()         // US-003 DoD : pas d'email pour ouvrier
    expect(ouvrier!.invitation_status).toBeNull()

    // qr_token doit exister dans la DB (mais pas exposé dans la réponse API — S-01)
    expect(ouvrier!.qr_token).toBeTruthy()

    // GET /api/users/[id]/qr — vérifier le PNG retourné
    const qrRes = await request.get(`${baseUrl}/api/users/${ouvrierId}/qr`)

    expect(qrRes.status()).toBe(200)

    // Vérifier Content-Type: image/png (US-003 DoD)
    const contentType = qrRes.headers()['content-type']
    expect(contentType).toContain('image/png')

    // Vérifier que le corps est un buffer PNG valide (commence par la signature PNG)
    const pngBuffer = await qrRes.body()
    expect(pngBuffer.length).toBeGreaterThan(0)

    // Signature PNG : bytes 0-7 = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    expect(pngBuffer[0]).toBe(0x89)
    expect(pngBuffer[1]).toBe(0x50) // 'P'
    expect(pngBuffer[2]).toBe(0x4E) // 'N'
    expect(pngBuffer[3]).toBe(0x47) // 'G'
  })

  test('S2 — Ouvrier sans email : pas de compte dans auth.users Supabase', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    await getAuthenticatedSession(request, org.email, org.password)

    const createRes = await request.post(`${baseUrl}/api/users`, {
      data: {
        role: 'ouvrier',
        nom: 'Legrand',
        prenom: 'Marc',
      },
    })

    expect(createRes.status()).toBe(201)

    const { data: { user_id: ouvrierId } } = await createRes.json() as {
      data: { user_id: string; role: string; has_supabase_auth: boolean }
    }

    // Vérifier que l'ouvrier N'EXISTE PAS dans auth.users Supabase
    const adminSupabase = createClient<Database>(
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
      process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: authUser, error: authError } = await adminSupabase.auth.admin.getUserById(ouvrierId)

    // L'ID de l'ouvrier est un UUID random (crypto.randomUUID()) côté API
    // Il ne devrait pas exister dans auth.users
    // Supabase retourne une erreur si l'user n'existe pas
    expect(authError || !authUser?.user).toBeTruthy()
  })

  test('S2 — GET QR pour conducteur (non-ouvrier) -> 400', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    await getAuthenticatedSession(request, org.email, org.password)

    // Créer un conducteur
    const conducteurEmail = `conducteur-qr-${crypto.randomUUID()}@e2e-clawbtp.test`
    const createRes = await request.post(`${baseUrl}/api/users`, {
      data: {
        role: 'conducteur',
        email: conducteurEmail,
        nom: 'Blanc',
        prenom: 'Luc',
      },
    })

    expect(createRes.status()).toBe(201)
    const { data: { user_id: conducteurId } } = await createRes.json() as {
      data: { user_id: string }
    }
    resources.authUserIds.push(conducteurId)

    // Tenter de récupérer le QR d'un conducteur -> 400 (conducteur n'a pas de QR)
    const qrRes = await request.get(`${baseUrl}/api/users/${conducteurId}/qr`)
    expect(qrRes.status()).toBe(400)
  })

  // ----------------------------------------------------------
  // S3 : Renvoi invitation expirée
  // ----------------------------------------------------------

  test('S3 — Renvoi invitation expirée : invitation_status=expired -> renvoi -> statut=pending', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    await getAuthenticatedSession(request, org.email, org.password)

    // Créer un conducteur (invitation_status='pending')
    const conducteurEmail = `conducteur-s3-${crypto.randomUUID()}@e2e-clawbtp.test`
    const createRes = await request.post(`${baseUrl}/api/users`, {
      data: {
        role: 'conducteur',
        email: conducteurEmail,
        nom: 'Moreau',
        prenom: 'Sophie',
      },
    })

    expect(createRes.status()).toBe(201)
    const { data: { user_id: conducteurId } } = await createRes.json() as {
      data: { user_id: string }
    }
    resources.authUserIds.push(conducteurId)

    // Forcer invitation_status='expired' directement en DB (pas besoin d'attendre 48h)
    const adminSupabase = createClient<Database>(
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
      process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    await adminSupabase
      .from('users')
      .update({ invitation_status: 'expired' })
      .eq('id', conducteurId)

    // POST /api/users/[id]/reinvite — renvoi invitation expirée
    const reinviteRes = await request.post(`${baseUrl}/api/users/${conducteurId}/reinvite`)

    expect(reinviteRes.status()).toBe(200)

    const reinviteBody = await reinviteRes.json() as {
      data: {
        user_id: string
        invitation_status: string
        message: string
      }
    }

    expect(reinviteBody.data.invitation_status).toBe('pending')
    expect(reinviteBody.data.message).toBeTruthy()

    // Vérifier en DB que le statut est bien repassé à 'pending'
    const { data: updatedUser } = await adminSupabase
      .from('users')
      .select('invitation_status')
      .eq('id', conducteurId)
      .single()

    expect(updatedUser!.invitation_status).toBe('pending')
  })

  test('S3 — Renvoi invitation NON expirée (statut=pending) -> 400', async ({ request }) => {
    const org = await createTestOrganisationDirect({ statut: 'trial_active' })
    resources.organisationIds.push(org.organisationId)
    resources.authUserIds.push(org.adminUserId)

    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

    await getAuthenticatedSession(request, org.email, org.password)

    // Créer un conducteur (invitation_status='pending' par défaut)
    const conducteurEmail = `conducteur-s3b-${crypto.randomUUID()}@e2e-clawbtp.test`
    const createRes = await request.post(`${baseUrl}/api/users`, {
      data: {
        role: 'conducteur',
        email: conducteurEmail,
        nom: 'Bernard',
        prenom: 'Claire',
      },
    })

    expect(createRes.status()).toBe(201)
    const { data: { user_id: conducteurId } } = await createRes.json() as {
      data: { user_id: string }
    }
    resources.authUserIds.push(conducteurId)

    // Tenter un renvoi alors que l'invitation n'est pas expirée (statut='pending') -> 400
    const reinviteRes = await request.post(`${baseUrl}/api/users/${conducteurId}/reinvite`)
    expect(reinviteRes.status()).toBe(400)
  })
})
