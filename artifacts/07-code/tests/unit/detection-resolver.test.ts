// tests/unit/detection-resolver.test.ts — Tests unitaires resolverDerivesChantier
// D-6-11 BINDING : best-effort, ne throw jamais, l'archivage ne dépend pas du succès.
// UPDATE idempotent WHERE resolved_at IS NULL (RG-DERIVE-012).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolverDerivesChantier } from '../../lib/detection/resolverDerives'

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

// ============================================================
// Helpers
// ============================================================

function makeClient(opts: {
  error?: { message: string } | null
  count?: number | null
  throws?: boolean
} = {}) {
  if (opts.throws) {
    return {
      from: vi.fn().mockImplementation(() => {
        throw new Error('DB connection refused')
      }),
    }
  }

  const queryMock = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({
      error: opts.error ?? null,
      count: opts.count ?? 2,
    }),
  }

  return {
    from: vi.fn().mockReturnValue(queryMock),
  }
}

describe('resolverDerivesChantier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolve les dérives actives (happy path) — UPDATE WHERE resolved_at IS NULL', async () => {
    const client = makeClient({ count: 3 })

    // Ne doit pas throw
    await expect(
      resolverDerivesChantier('chantier-1', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    ).resolves.toBeUndefined()

    // Vérifie que from('derives_detectees') a été appelé
    expect(client.from).toHaveBeenCalledWith('derives_detectees')
  })

  it('D-6-11 BINDING : ne throw jamais si erreur DB (best-effort)', async () => {
    const client = makeClient({ error: { message: 'relation "derives_detectees" does not exist' } })

    await expect(
      resolverDerivesChantier('chantier-1', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    ).resolves.toBeUndefined()
  })

  it('D-6-11 BINDING : ne throw jamais si le client DB explose complètement', async () => {
    const client = makeClient({ throws: true })

    await expect(
      resolverDerivesChantier('chantier-1', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    ).resolves.toBeUndefined()
  })

  it('retourne void (pas de valeur de retour) même en succès', async () => {
    const client = makeClient({ count: 0 })
    const result = await resolverDerivesChantier('chantier-1', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result).toBeUndefined()
  })

  it('UPDATE est idempotent — ne touche que resolved_at IS NULL (filtre .is("resolved_at", null))', async () => {
    const queryMock = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ error: null, count: 1 }),
    }
    const client = { from: vi.fn().mockReturnValue(queryMock) }

    await resolverDerivesChantier('ch-2', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)

    // Vérifie que le filtre IS NULL a été appliqué (idempotence)
    expect(queryMock.is).toHaveBeenCalledWith('resolved_at', null)
    // Vérifie que le filtre chantier_id a été appliqué (isolation)
    expect(queryMock.eq).toHaveBeenCalledWith('chantier_id', 'ch-2')
  })
})
