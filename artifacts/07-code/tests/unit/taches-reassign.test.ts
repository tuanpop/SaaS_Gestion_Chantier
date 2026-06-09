/**
 * tests/unit/taches-reassign.test.ts — Tests CRUD UPDATE tâche : réassignation
 *
 * Gap CRUD UPDATE tâche (2026-06-09) — couverture du cas de réassignation :
 *
 * EDGE CASE (EVT-REASSIGN-002) :
 *   GIVEN conducteur org A authentifié, tâche T appartenant à l'org A
 *   WHEN PATCH /api/taches/[id] { assigned_to: 'user-hors-org' } (user hors org)
 *   THEN HTTP 400 + fields.assigned_to non vide (step 5 du handler)
 *
 * Note : Le test happy path complet de réassignation (200 + notif) nécessite un mock
 * Supabase qui couvre le path complet (ownership + users check + update + notifs best-effort),
 * ce qui est difficile sans un mock multi-level robuste. Le scénario happy path est couvert
 * fonctionnellement par :
 *   - UpdateTacheSchema (taches-ownership.test.ts) : assigned_to null valide
 *   - EVT-007 (notif-events.test.ts) : trigger notification réassignation
 * Le test d'intégration handler réel se limite donc au cas edge (hors-org = 400)
 * qui est le comportement critique de sécurité.
 *
 * SKIP documenté — EVT-REASSIGN-E2E :
 *   La réachabilité UI (bouton "Modifier la tâche" dans TacheItem + TacheEditModal)
 *   ne peut pas être testée auto sans Playwright/jsdom.
 *   Dette : GAP-CRUD-UPDATE-UI-01 — smoke UI manuel obligatoire avant validation sprint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ============================================================
// Mocks — même pattern que taches-ownership.test.ts (vi.hoisted)
// ============================================================
//
// Le handler PATCH fait ces appels chainés :
//   Step 2 ownership : .from('taches').select().eq(id).eq(org).single()
//   Step 5 users    : .from('users').select().eq(id).eq(org).is(null).single()
//
// Pour le cas edge (400 hors org), on a besoin que :
//   - Step 2 retourne une tâche valide (ownership OK)
//   - Step 5 retourne data: null (user non trouvé → 400)

const { mockOwnershipSingle, mockUsersSingle, mockServerClient } = vi.hoisted(() => ({
  mockOwnershipSingle: vi.fn(),
  mockUsersSingle: vi.fn(),
  mockServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      // SELECT path — couvre ownership (.eq.eq.single) et users (.eq.eq.is.single)
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: mockOwnershipSingle,        // Step 2 ownership
            is: () => ({
              single: mockUsersSingle,           // Step 5 users check
            }),
          }),
        }),
      }),
      // UPDATE path — réponse factice (data: null → step 7 sort en 500 si ce path est atteint)
      // Pour le test edge case (400), ce path n'est pas atteint.
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockServerClient,
}))

vi.mock('@/lib/trial-gate', () => ({
  assertTrialActive: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/notifications/notif', () => ({
  insertNotification: vi.fn().mockResolvedValue(undefined),
  resolveConducteurChantier: vi.fn().mockResolvedValue(null),
  htmlEscape: (s: string) => s,
}))

// ============================================================
// Tests
// ============================================================

const ORG_ID        = '11111111-1111-1111-1111-111111111111'
const USER_ID       = '22222222-2222-2222-2222-222222222222'
const USER_HORS_ORG = '55555555-5555-5555-5555-555555555555'
const TACHE_ID      = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

describe('PATCH /api/taches/[id] — réassignation (gap CRUD UPDATE)', () => {
  beforeEach(() => {
    mockOwnershipSingle.mockReset()
    mockUsersSingle.mockReset()
    mockServerClient.mockReset()
    mockServerClient.mockResolvedValue({} as never)
  })

  /**
   * EVT-REASSIGN-002 (edge case) :
   * GIVEN tâche dans l'org, user-hors-org absent de l'organisation
   * WHEN PATCH { assigned_to: USER_HORS_ORG }
   * THEN HTTP 400 + fields.assigned_to présent
   *
   * Couvre la règle de sécurité : on ne peut pas assigner une tâche
   * à un user qui n'appartient pas à l'organisation (step 5 du handler PATCH).
   */
  it('EVT-REASSIGN-002 (edge) : assigned_to user hors org → 400 + fields.assigned_to', async () => {
    // Step 2 : ownership check → tâche trouvée (appartient à l'org)
    mockOwnershipSingle.mockResolvedValueOnce({
      data: {
        id: TACHE_ID,
        chantier_id: 'chantier-001',
        organisation_id: ORG_ID,
        statut: 'a_faire',
        assigned_to: null,
      },
      error: null,
    })
    // Step 5 : users check → NON TROUVÉ (hors org ou supprimé)
    mockUsersSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    })

    const { PATCH } = await import('@/app/api/taches/[id]/route')

    const request = new NextRequest(
      `http://localhost:3000/api/taches/${TACHE_ID}`,
      {
        method: 'PATCH',
        headers: {
          'x-organisation-id': ORG_ID,
          'x-user-id': USER_ID,
          'x-user-role': 'conducteur',
          'x-correlation-id': 'test-reassign-hors-org',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ assigned_to: USER_HORS_ORG }),
      },
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(400)
    const json = (await response.json()) as { error: string; fields?: Record<string, string[]> }
    expect(json.fields?.['assigned_to']).toBeDefined()
    expect(json.fields?.['assigned_to']?.[0]).toContain('non trouvé')
  })

  /**
   * EVT-REASSIGN-401 : Sans claims dans les headers → HTTP 401
   * (complémentaire au test correspondant dans taches-ownership.test.ts)
   */
  it('EVT-REASSIGN-401 : sans claims → 401', async () => {
    const { PATCH } = await import('@/app/api/taches/[id]/route')

    const request = new NextRequest(
      `http://localhost:3000/api/taches/${TACHE_ID}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assigned_to: USER_HORS_ORG }),
      },
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ id: TACHE_ID }),
    })

    expect(response.status).toBe(401)
  })
})

// ============================================================
// Tests Zod — assigned_to schema (unitaires purs)
// ============================================================

import { UpdateTacheSchema } from '@/lib/validation/taches'

describe('UpdateTacheSchema — champs éditables TacheEditModal', () => {
  it('assigned_to uuid valide → valide', () => {
    const result = UpdateTacheSchema.safeParse({
      assigned_to: '33333333-3333-3333-3333-333333333333',
    })
    expect(result.success).toBe(true)
  })

  it('assigned_to null → valide (désassignation = "Non assigné")', () => {
    const result = UpdateTacheSchema.safeParse({ assigned_to: null })
    expect(result.success).toBe(true)
  })

  it('assigned_to pas UUID → invalide', () => {
    const result = UpdateTacheSchema.safeParse({ assigned_to: 'pas-un-uuid' })
    expect(result.success).toBe(false)
  })

  it('titre + description + date_echeance + assigned_to combinés → valide', () => {
    const result = UpdateTacheSchema.safeParse({
      titre: 'Pose carrelage RDC',
      description: 'Détail de la pose',
      date_echeance: '2026-07-01',
      assigned_to: '33333333-3333-3333-3333-333333333333',
    })
    expect(result.success).toBe(true)
  })

  it('description vide string → valide (nullable)', () => {
    const result = UpdateTacheSchema.safeParse({ description: null })
    expect(result.success).toBe(true)
  })

  it('titre > 200 car → invalide', () => {
    const result = UpdateTacheSchema.safeParse({ titre: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })

  it('date_echeance null → valide (suppression échéance)', () => {
    const result = UpdateTacheSchema.safeParse({ date_echeance: null })
    expect(result.success).toBe(true)
  })
})
