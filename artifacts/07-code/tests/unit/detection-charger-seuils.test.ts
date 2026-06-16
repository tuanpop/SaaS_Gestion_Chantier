// tests/unit/detection-charger-seuils.test.ts — Tests unitaires chargerSeuils
// PO-6-02=B : chargerSeuils charge depuis seuils_derives, fallback sur SEUILS_DEFAUT si absent.
// Jamais throws.

import { describe, it, expect, vi } from 'vitest'
import { SEUILS_DEFAUT } from '../../types/detection'

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

// Import dynamique pour contourner le mock
async function importChargerSeuils() {
  const { chargerSeuils } = await import('../../lib/detection/chargerSeuils')
  return chargerSeuils
}

// Crée un adminClient qui retourne des données depuis seuils_derives
function makeClient(opts: {
  data: unknown | null
  error?: { message: string } | null
}) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: opts.data,
        error: opts.error ?? null,
      }),
    }),
  }
}

describe('chargerSeuils', () => {
  it('retourne les seuils DB si la ligne existe (source=db)', async () => {
    const chargerSeuils = await importChargerSeuils()
    const client = makeClient({
      data: { ratio_budget: 0.70, jours_blocage: 5, jours_inactivite: 14 },
    })

    const result = await chargerSeuils('org-1', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result.ratio_budget).toBe(0.70)
    expect(result.jours_blocage).toBe(5)
    expect(result.jours_inactivite).toBe(14)
    expect(result.source).toBe('db')
    expect(result.organisation_id).toBe('org-1')
  })

  it('retourne les SEUILS_DEFAUT si aucune ligne (maybeSingle retourne null)', async () => {
    const chargerSeuils = await importChargerSeuils()
    const client = makeClient({ data: null })

    const result = await chargerSeuils('org-2', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(result.ratio_budget).toBe(SEUILS_DEFAUT.ratio_budget)
    expect(result.jours_blocage).toBe(SEUILS_DEFAUT.jours_blocage)
    expect(result.jours_inactivite).toBe(SEUILS_DEFAUT.jours_inactivite)
    expect(result.source).toBe('defaut')
  })

  it('retourne les SEUILS_DEFAUT si erreur DB (never throws)', async () => {
    const chargerSeuils = await importChargerSeuils()
    const client = makeClient({ data: null, error: { message: 'DB connection failed' } })

    // Ne doit pas throw
    const result = await expect(
      chargerSeuils('org-3', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    ).resolves.toBeDefined()

    const actualResult = await chargerSeuils('org-3', client as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    expect(actualResult.source).toBe('defaut')
  })

  it('ne throw jamais même si le client DB explose complètement', async () => {
    const chargerSeuils = await importChargerSeuils()
    const throwingClient = {
      from: vi.fn().mockImplementation(() => {
        throw new Error('Connection refused')
      }),
    }

    await expect(
      chargerSeuils('org-4', throwingClient as unknown as ReturnType<typeof import('../../lib/supabase/admin').createAdminClient>)
    ).resolves.toBeDefined()
  })
})
