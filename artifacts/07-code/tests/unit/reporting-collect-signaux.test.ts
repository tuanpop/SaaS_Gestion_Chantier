/**
 * tests/unit/reporting-collect-signaux.test.ts
 * TST-K5-01 : collectSignaux ne retourne jamais note_privee_conducteur
 * TST-K5-02 : collectSignaux ne retourne jamais storage_path ni signed_url
 * TST-K5-05 : donnees_brutes exclude secret fields
 * D-008 : collectSignaux est pure TS, pas d'appel LLM
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase admin
const mockSingle = vi.fn()
const mockIn = vi.fn()
const mockEq = vi.fn()
const mockGte = vi.fn()
const mockLte = vi.fn()
const mockOrder = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

// Chaîne mock fluente
function makeChain() {
  const chain: Record<string, unknown> = {}
  chain['from'] = mockFrom
  chain['select'] = mockSelect
  chain['eq'] = mockEq
  chain['in'] = mockIn
  chain['gte'] = mockGte
  chain['lte'] = mockLte
  chain['order'] = mockOrder
  chain['single'] = mockSingle

  const fluent = new Proxy(chain, {
    get(target, prop) {
      if (prop in target) return (..._args: unknown[]) => fluent
      return undefined
    },
  })
  return fluent
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => makeChain()),
}))

// Import AFTER mocking
import { collectSignaux } from '@/lib/reporting/collectSignaux'

describe('collectSignaux — exclusion champs sensibles (TST-K5-01, TST-K5-02, D-008)', () => {
  it('TST-K5-01 : le SELECT taches ne contient pas note_privee_conducteur', () => {
    // Vérification statique — on lit la source pour s'assurer que le champ est absent
    // C'est la garantie de D-008 : champ structurellement absent du SELECT
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/collectSignaux.ts'),
      'utf-8',
    )
    // Le SELECT des taches ne doit pas contenir note_privee_conducteur
    // (D-008 : exclusion structurelle)
    expect(source).not.toMatch(/note_privee_conducteur/)
  })

  it('TST-K5-02 : le SELECT photos ne contient pas storage_path ni signed_url', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/collectSignaux.ts'),
      'utf-8',
    )
    expect(source).not.toMatch(/storage_path/)
    expect(source).not.toMatch(/signed_url/)
  })

  it('D-008 : collectSignaux.ts n\'importe aucun LLM client', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/collectSignaux.ts'),
      'utf-8',
    )
    // Pas d'import de anthropic, LLMClient, getLLMClient
    expect(source).not.toMatch(/anthropic/i)
    expect(source).not.toMatch(/getLLMClient/)
    expect(source).not.toMatch(/ILLMClient/)
  })

  it('TST-K5-05 : type SignauxTerrain n\'a pas de champ note_privee_conducteur, storage_path, signed_url', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../types/reporting.ts'),
      'utf-8',
    )
    // SignalTache ne doit pas avoir note_privee_conducteur
    // SignalPhoto ne doit pas avoir storage_path ni signed_url
    // Vérification structurelle du contrat de type
    expect(source).not.toMatch(/note_privee_conducteur/)
    expect(source).not.toMatch(/storage_path/)
    expect(source).not.toMatch(/signed_url/)
  })
})

describe('isoWeek — calculs déterministes (D-008)', () => {
  it('getIsoWeek retourne un numéro de semaine valide (1-53)', async () => {
    const { getIsoWeek } = await import('@/lib/reporting/isoWeek')
    const semaine = getIsoWeek(new Date('2026-06-10'))
    expect(semaine).toBeGreaterThanOrEqual(1)
    expect(semaine).toBeLessThanOrEqual(53)
  })

  it('getWeekBounds retourne lundi et dimanche corrects', async () => {
    const { getWeekBounds, getIsoWeek, getIsoYear } = await import('@/lib/reporting/isoWeek')
    const d = new Date('2026-06-10') // mercredi
    const semaine = getIsoWeek(d)
    const annee = getIsoYear(d)
    const { lundi, dimanche } = getWeekBounds(annee, semaine)
    expect(lundi).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dimanche).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // lundi <= dimanche
    expect(lundi <= dimanche).toBe(true)
  })

  it('formatSemaineLabel retourne une chaîne non vide', async () => {
    const { formatSemaineLabel } = await import('@/lib/reporting/isoWeek')
    const label = formatSemaineLabel(2026, 24)
    expect(label).toBeTruthy()
    expect(label).toContain('24')
  })
})
