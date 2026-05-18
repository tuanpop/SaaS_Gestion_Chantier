/**
 * tests/unit/taches-ownership.test.ts — Tests ownership tâches + bloque_raison
 *
 * Scénarios (SPRINT_2_PLAN.md §F.3) :
 *   1. bloque_raison absente avec statut='bloque' -> HTTP 400 (Zod)
 *   2. bloque_raison < 10 car. avec statut='bloque' -> HTTP 400 (Zod)
 *   3. happy path bloque avec raison >= 10 car. -> schéma valide
 *   4. hors périmètre conducteur -> HTTP 404 (vrai test du handler avec mock Supabase)
 *
 * Note : le schéma est importé depuis lib/validation/taches.ts (GAP-zod-dupliqué fixé).
 * Le scénario 4 teste le handler PATCH en mockant createAdminClient pour simuler
 * une tâche hors organisation (RLS retourne null) — GAP-test-tautologique fixé.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { UpdateTacheSchema } from '@/lib/validation/taches'

// ============================================================
// Tests Zod (unitaires purs — pas de DB)
// ============================================================

describe('UpdateTacheSchema — validation bloque_raison', () => {
  it('Scénario 1 — statut=bloque sans bloque_raison -> invalide', () => {
    const result = UpdateTacheSchema.safeParse({ statut: 'bloque' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = result.error.flatten()
      expect(errors.fieldErrors['bloque_raison']).toBeDefined()
      expect(errors.fieldErrors['bloque_raison']?.[0]).toContain('bloque_raison obligatoire')
    }
  })

  it('Scénario 2 — statut=bloque avec bloque_raison < 10 car -> invalide', () => {
    const result = UpdateTacheSchema.safeParse({
      statut: 'bloque',
      bloque_raison: 'court',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = result.error.flatten()
      const hasError =
        errors.fieldErrors['bloque_raison'] !== undefined ||
        errors.formErrors.length > 0
      expect(hasError).toBe(true)
    }
  })

  it('statut=bloque avec bloque_raison exactement 9 car -> invalide', () => {
    const result = UpdateTacheSchema.safeParse({
      statut: 'bloque',
      bloque_raison: '123456789',
    })
    expect(result.success).toBe(false)
  })

  it('Scénario 3 — happy path : statut=bloque + raison >= 10 car -> valide', () => {
    const result = UpdateTacheSchema.safeParse({
      statut: 'bloque',
      bloque_raison: 'Livraison béton repoussée semaine prochaine',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.statut).toBe('bloque')
      expect(result.data.bloque_raison).toBe('Livraison béton repoussée semaine prochaine')
    }
  })

  it('bloque_raison exactement 10 car. (limite min) -> valide', () => {
    const result = UpdateTacheSchema.safeParse({
      statut: 'bloque',
      bloque_raison: '1234567890',
    })
    expect(result.success).toBe(true)
  })

  it('statut=en_cours sans bloque_raison -> valide (raison optionnelle)', () => {
    const result = UpdateTacheSchema.safeParse({ statut: 'en_cours' })
    expect(result.success).toBe(true)
  })

  it('PATCH statut=termine sans bloque_raison -> valide', () => {
    const result = UpdateTacheSchema.safeParse({ statut: 'termine' })
    expect(result.success).toBe(true)
  })

  it('assigned_to null -> valide (désassignation)', () => {
    const result = UpdateTacheSchema.safeParse({ assigned_to: null })
    expect(result.success).toBe(true)
  })

  it('assigned_to invalide (pas UUID) -> invalide', () => {
    const result = UpdateTacheSchema.safeParse({ assigned_to: 'pas-un-uuid' })
    expect(result.success).toBe(false)
  })

  it('titre vide -> invalide', () => {
    const result = UpdateTacheSchema.safeParse({ titre: '' })
    expect(result.success).toBe(false)
  })

  it('titre > 200 car -> invalide', () => {
    const result = UpdateTacheSchema.safeParse({ titre: 'a'.repeat(201) })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// Mocks Supabase + trial-gate pour le test handler
// ============================================================

// Le mock retourne un client chainable dont .single() renvoie ce qu'on a configuré.
// vi.hoisted permet de déclarer la variable avant que vi.mock l'utilise (hoisting Vitest).
const { mockAdminFromSingle, mockServerClient } = vi.hoisted(() => ({
  mockAdminFromSingle: vi.fn(),
  mockServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: mockAdminFromSingle,
          }),
        }),
      }),
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

// ============================================================
// Scénario 4 : ownership — vrai test du handler PATCH
// ============================================================

describe('PATCH /api/taches/[id] — ownership check (Scénario 4)', () => {
  beforeEach(() => {
    mockAdminFromSingle.mockReset()
    mockServerClient.mockReset()
    mockServerClient.mockResolvedValue({} as never)
  })

  /**
   * GIVEN conducteur org A authentifié
   * WHEN PATCH /api/taches/[id_tache_org_B] (tâche hors org)
   * THEN HTTP 404 + error 'Ressource introuvable.' (I-06)
   *
   * Le filtre .eq('organisation_id', organisationId) combiné à .single() fait que
   * Supabase retourne data=null si la tâche n'appartient pas à l'organisation du caller.
   */
  it('Scénario 4 — tâche hors organisation -> HTTP 404 (I-06)', async () => {
    // RLS / filtre org bloque la requête : pas de tâche trouvée
    mockAdminFromSingle.mockResolvedValue({ data: null, error: null })

    const { PATCH } = await import('@/app/api/taches/[id]/route')

    const request = new NextRequest('http://localhost:3000/api/taches/aaaaaaaa-0000-0000-0000-000000000000', {
      method: 'PATCH',
      headers: {
        'x-organisation-id': '11111111-1111-1111-1111-111111111111',
        'x-user-id': '22222222-2222-2222-2222-222222222222',
        'x-user-role': 'conducteur',
        'x-correlation-id': 'test-corr-id',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ statut: 'termine' }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'aaaaaaaa-0000-0000-0000-000000000000' }),
    })

    expect(response.status).toBe(404)
    const json = (await response.json()) as { error: string }
    expect(json.error).toBe('Ressource introuvable.')
  })

  it('Scénario 4 bis — erreur DB sur la query ownership -> 404 (pas de fuite)', async () => {
    // Si Supabase retourne une erreur (ex: tâche supprimée pendant la requête),
    // le handler doit aussi renvoyer 404 — jamais 500 avec stack trace (I-03).
    mockAdminFromSingle.mockResolvedValue({
      data: null,
      error: { message: 'PGRST116: 0 rows', code: 'PGRST116' },
    })

    const { PATCH } = await import('@/app/api/taches/[id]/route')

    const request = new NextRequest('http://localhost:3000/api/taches/bbbbbbbb-0000-0000-0000-000000000000', {
      method: 'PATCH',
      headers: {
        'x-organisation-id': '11111111-1111-1111-1111-111111111111',
        'x-user-id': '22222222-2222-2222-2222-222222222222',
        'x-user-role': 'conducteur',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ statut: 'en_cours' }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'bbbbbbbb-0000-0000-0000-000000000000' }),
    })

    expect(response.status).toBe(404)
  })

  it('Sans claims dans les headers -> HTTP 401', async () => {
    const { PATCH } = await import('@/app/api/taches/[id]/route')

    const request = new NextRequest('http://localhost:3000/api/taches/cccccccc-0000-0000-0000-000000000000', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statut: 'en_cours' }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'cccccccc-0000-0000-0000-000000000000' }),
    })

    expect(response.status).toBe(401)
  })
})
