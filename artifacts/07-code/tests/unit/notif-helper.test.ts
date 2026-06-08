/**
 * tests/unit/notif-helper.test.ts
 * Tests lib/notifications/notif.ts (helper interne)
 *
 * TST-NF-01 : htmlEscape — caractères dangereux XSS échappés dans l'ordre correct
 * TST-NF-02 : htmlEscape — double-encodage de & en premier
 * TST-NF-03 : insertNotification — userId vide → warn + return silencieux (D-4V-002)
 * TST-NF-04 : insertNotification — best-effort : erreur INSERT → jamais throw (D-4V-002)
 * TST-NF-05 : insertNotification — idempotence : notif non lue existante → skip INSERT
 * TST-NF-06 : insertNotification — K4V-09 : InsertNotificationParams n'a pas note_privee_conducteur
 * TST-NF-07 : insertNotification — chantierId null → IS NULL branch (.is('chantier_id', null))
 * TST-NF-08 : insertNotification — titre/message tronqués après htmlEscape (max 200 / 1000)
 * TST-NF-09 : insertNotification — erreur SELECT → warn + return silencieux (best-effort)
 * TST-NF-10 : htmlEscape — & en premier pour éviter double-encodage de &lt;
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks
// ============================================================

const mockLoggerWarn = vi.fn()

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}))

// adminClient mock — factory reconfigurable par chaque test
let adminClientFactory: () => unknown

vi.mock('../../lib/supabase/admin', () => ({
  createAdminClient: () => adminClientFactory(),
}))

// Import SUT après mocks
import { htmlEscape, insertNotification } from '../../lib/notifications/notif'
import type { InsertNotificationParams } from '../../lib/notifications/notif'

// ============================================================
// Params de base valides
// ============================================================

const BASE_PARAMS: InsertNotificationParams = {
  organisationId: 'org-001',
  userId: 'user-001',
  type: 'affectation_tache',
  titre: 'Nouvelle tâche assignée',
  message: 'Vous avez été assigné à la tâche.',
  chantierId: 'chantier-001',
  tacheId: 'tache-001',
}

// ============================================================
// Helper : créer un "query builder" mock qui :
//   - retourne `this` sur select/eq/is/order/limit (chainable)
//   - résout `resolveValue` quand `await`-é (via then/catch/finally)
// ============================================================

function makeQueryChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {}

  // thenable : permet d'await le chain directement
  chain['then'] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue).then(resolve, reject)
  chain['catch'] = (reject: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue).catch(reject)

  // Méthodes de filtre — toutes retournent le même chain (pour intercepter les is/eq)
  const isCalls: Array<[string, unknown]> = []
  const eqCalls: Array<[string, unknown]> = []

  chain['select'] = vi.fn().mockReturnValue(chain)
  chain['eq'] = vi.fn().mockImplementation((col: string, val: unknown) => {
    eqCalls.push([col, val])
    return chain
  })
  chain['is'] = vi.fn().mockImplementation((col: string, val: unknown) => {
    isCalls.push([col, val])
    return chain
  })
  chain['limit'] = vi.fn().mockReturnValue(chain)
  chain['order'] = vi.fn().mockReturnValue(chain)
  chain['single'] = vi.fn().mockReturnValue(chain)

  chain['_isCalls'] = isCalls
  chain['_eqCalls'] = eqCalls

  return chain
}

// ============================================================
// Tests htmlEscape
// ============================================================

describe('htmlEscape', () => {
  it('TST-NF-01 : échappe les 5 caractères dangereux', () => {
    const input = `<script>alert("XSS")&Bob's</script>`
    const output = htmlEscape(input)
    expect(output).toContain('&lt;script&gt;')
    expect(output).toContain('alert(&quot;XSS&quot;)')
    expect(output).toContain('&amp;Bob&#39;s')
    expect(output).not.toContain('<')
    expect(output).not.toContain('>')
    expect(output).not.toContain('"')
    expect(output).not.toContain("'")
  })

  it('TST-NF-02 : & dans un input est encodé → &amp;', () => {
    const output = htmlEscape('foo & bar')
    expect(output).toBe('foo &amp; bar')
  })

  it('TST-NF-10 : & encodé EN PREMIER — évite que &lt; devienne &amp;lt;', () => {
    const output = htmlEscape('<hello>')
    expect(output).toBe('&lt;hello&gt;')
    expect(output).not.toContain('&amp;lt;')
  })
})

// ============================================================
// Tests insertNotification
// ============================================================

describe('insertNotification — garde-fous (D-4V-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminClientFactory = () => ({ from: vi.fn() })
  })

  it('TST-NF-03 : userId vide → warn + return silencieux, jamais throw', async () => {
    const fromMock = vi.fn()
    adminClientFactory = () => ({ from: fromMock })
    const params: InsertNotificationParams = { ...BASE_PARAMS, userId: '' }

    await expect(insertNotification(params)).resolves.toBeUndefined()

    expect(mockLoggerWarn).toHaveBeenCalledOnce()
    const [warnArg] = mockLoggerWarn.mock.calls[0] as [Record<string, unknown>, string]
    expect(warnArg['type']).toBe('affectation_tache')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('TST-NF-04 : erreur INSERT → warn + return silencieux, jamais throw (best-effort)', async () => {
    // SELECT vide OK
    const selectChain = makeQueryChain({ data: [], error: null })
    // INSERT erreur
    const insertChain = makeQueryChain({ error: { message: 'DB error forced' } })

    let callCount = 0
    adminClientFactory = () => ({
      from: (_t: string) => {
        callCount++
        if (callCount === 1) return selectChain
        return { insert: vi.fn().mockReturnValue(insertChain) }
      },
    })

    await expect(insertNotification(BASE_PARAMS)).resolves.toBeUndefined()

    expect(mockLoggerWarn).toHaveBeenCalledOnce()
    const [warnArg] = mockLoggerWarn.mock.calls[0] as [Record<string, unknown>, string]
    expect(warnArg['err']).toBe('DB error forced')
  })

  it('TST-NF-05 : notif non lue existante → SELECT retourne 1 résultat → INSERT skippé', async () => {
    // SELECT retourne 1 notif existante
    const selectChain = makeQueryChain({ data: [{ id: 'existing-notif' }], error: null })

    const fromMock = vi.fn().mockReturnValue(selectChain)
    adminClientFactory = () => ({ from: fromMock })

    await insertNotification(BASE_PARAMS)

    // from appelé 1 seule fois (SELECT), pas de second appel pour INSERT
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('TST-NF-07 : chantierId null → .is("chantier_id", null) appelée', async () => {
    const selectChain = makeQueryChain({ data: [], error: null })
    const insertResult = makeQueryChain({ error: null })

    let callCount = 0
    adminClientFactory = () => ({
      from: (_t: string) => {
        callCount++
        if (callCount === 1) return selectChain
        return { insert: vi.fn().mockReturnValue(insertResult) }
      },
    })

    const params: InsertNotificationParams = {
      ...BASE_PARAMS,
      chantierId: null,
      tacheId: null,
    }

    await insertNotification(params)

    // Vérifier que .is() a été appelé avec 'chantier_id', null
    const isCalls = selectChain['_isCalls'] as Array<[string, unknown]>
    const chantierIsCall = isCalls.find(([col]) => col === 'chantier_id')
    const tacheIsCall = isCalls.find(([col]) => col === 'tache_id')

    expect(chantierIsCall).toBeDefined()
    expect(chantierIsCall?.[1]).toBeNull()
    expect(tacheIsCall).toBeDefined()
    expect(tacheIsCall?.[1]).toBeNull()
  })

  it('TST-NF-08 : titre/message tronqués après htmlEscape (max 200 / 1000 chars)', async () => {
    const selectChain = makeQueryChain({ data: [], error: null })
    let capturedPayload: Record<string, unknown> | null = null

    let callCount = 0
    adminClientFactory = () => ({
      from: (_t: string) => {
        callCount++
        if (callCount === 1) return selectChain
        const resultChain = makeQueryChain({ error: null })
        return {
          insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            capturedPayload = payload
            return resultChain
          }),
        }
      },
    })

    const params: InsertNotificationParams = {
      ...BASE_PARAMS,
      titre: 'A'.repeat(250),
      message: 'B'.repeat(1200),
    }

    await insertNotification(params)

    expect(capturedPayload).not.toBeNull()
    expect((capturedPayload!['titre'] as string).length).toBeLessThanOrEqual(200)
    expect((capturedPayload!['message'] as string).length).toBeLessThanOrEqual(1000)
  })

  it('TST-NF-09 : erreur SELECT → warn + return silencieux (best-effort)', async () => {
    const selectChain = makeQueryChain({ data: null, error: { message: 'connection timeout' } })
    adminClientFactory = () => ({
      from: vi.fn().mockReturnValue(selectChain),
    })

    await expect(insertNotification(BASE_PARAMS)).resolves.toBeUndefined()

    expect(mockLoggerWarn).toHaveBeenCalledOnce()
    const [warnArg] = mockLoggerWarn.mock.calls[0] as [Record<string, unknown>, string]
    expect(warnArg['err']).toBe('connection timeout')
  })
})

describe('InsertNotificationParams — K4V-09 (note_privee_conducteur absent)', () => {
  it('TST-NF-06 : le type InsertNotificationParams n\'a pas de champ note_privee_conducteur', () => {
    const params: InsertNotificationParams = {
      organisationId: 'org-001',
      userId: 'user-001',
      type: 'tache_terminee',
      titre: 'Tâche terminée',
      message: 'La tâche a été marquée terminée.',
    }

    // @ts-expect-error note_privee_conducteur MUST NOT be in InsertNotificationParams (K4V-09)
    params['note_privee_conducteur'] = 'valeur confidentielle'

    expect(params).toBeDefined()
  })
})
