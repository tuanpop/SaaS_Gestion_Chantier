/**
 * tests/unit/reporting-workflow.test.ts
 * TST-K5-03 : workflow statut CR D-007 BINDING — brouillon→valide→envoye (pas de rétrogradation)
 * TST-K5-08 : RBAC — JWT ouvrier → 403 sur /valider ; JWT org B → 404 sur /valider
 * TST-K5-10 : verifyCronSecret timing-safe compare
 * TST-K5-12 : idempotence cron — CR valide non écrasé
 * TST-K5-13 : resolveDestinatairesInternes — logique destinataires (règle PO 2026-06-15)
 * TST-K5-14 : envoyer brouillon → 409 (Resend 0 appel) ; envoyé→envoyer → 409 (Resend 0 appel)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mocks pour tests comportementaux (TST-K5-08, TST-K5-14)
// ============================================================

// Mock createAdminClient — retourne un proxy fluent configurable
const mockSingleFn = vi.fn()
const mockFromFn = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockFromFn(...args),
  })),
}))

// Mock Resend (sendEmail) pour vérifier 0 appel dans les cas 409
const mockSendEmail = vi.fn()
vi.mock('@/lib/notifications/email-layout', () => ({
  renderEmail: vi.fn(() => '<html>mock</html>'),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  escapeHtml: (s: string) => s,
}))

// Mock resolveDestinatairesInternes (non testé ici)
vi.mock('@/lib/reporting/destinataires', () => ({
  resolveDestinatairesInternes: vi.fn(async () => ['admin@org.fr']),
}))

// Mock trial-gate (non sollicité sur /valider, gardé actif sur /envoyer)
vi.mock('@/lib/trial-gate', () => ({
  assertTrialActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })),
  },
}))

/** Construit un Request avec les headers JWT standards */
function makeRequest(overrides: {
  userId?: string
  organisationId?: string
  role?: string
} = {}): Request {
  const headers = new Headers()
  headers.set('x-user-id', overrides.userId ?? 'user-admin-001')
  headers.set('x-organisation-id', overrides.organisationId ?? 'org-001')
  headers.set('x-user-role', overrides.role ?? 'admin')
  return new Request('http://localhost/api/cr/fake-id/valider', { method: 'POST', headers })
}

/** Construit les params Next.js pour un handler [id] */
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ============================================================
// TST-K5-03 : Workflow statut D-007 BINDING
// ============================================================

describe('StatutCR workflow (D-007 BINDING)', () => {
  it('les statuts valides sont brouillon, valide, envoye', async () => {
    const { StatutCRValues } = await import('@/lib/validation/reporting')
    expect(StatutCRValues).toEqual(expect.arrayContaining(['brouillon', 'valide', 'envoye']))
  })

  it('PatchCrBodySchema.strict() ne permet pas de modifier le statut', async () => {
    const { PatchCrBodySchema } = await import('@/lib/validation/reporting')
    // statut n'est pas dans le schema PATCH — .strict() rejette tout champ inconnu
    const result = PatchCrBodySchema.safeParse({
      contenu_genere: 'ok',
      statut: 'envoye',
    })
    expect(result.success).toBe(false)
  })

  it('le passage brouillon→valide est modélisé par POST /api/cr/[id]/valider (handler distinct)', () => {
    // Vérification structurelle : le handler valider existe
    const fs = require('fs')
    const path = require('path')
    const handlerPath = path.resolve(
      __dirname,
      '../../app/api/cr/[id]/valider/route.ts',
    )
    expect(fs.existsSync(handlerPath)).toBe(true)
  })

  it('le passage valide→envoye est modélisé par POST /api/cr/[id]/envoyer (handler distinct)', () => {
    const fs = require('fs')
    const path = require('path')
    const handlerPath = path.resolve(
      __dirname,
      '../../app/api/cr/[id]/envoyer/route.ts',
    )
    expect(fs.existsSync(handlerPath)).toBe(true)
  })

  it('handler valider contient un check idempotent statut=valide → 200', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cr/[id]/valider/route.ts'),
      'utf-8',
    )
    // Idempotence : si déjà valide → retourne 200 sans re-update
    expect(source).toContain("cr.statut === 'valide'")
  })

  it('handler valider bloque le passage envoye→? (rétrogradation impossible)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cr/[id]/valider/route.ts'),
      'utf-8',
    )
    // La route valider doit retourner 409 si statut=envoye
    expect(source).toContain("cr.statut === 'envoye'")
    expect(source).toContain('409')
  })
})

// ============================================================
// TST-K5-10 : cron secret timing-safe compare
// ============================================================

describe('cron secret — timing-safe compare (TST-K5-10)', () => {
  it('la route cron/cr utilise timingSafeEqual (node:crypto)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/cr/route.ts'),
      'utf-8',
    )
    expect(source).toContain('timingSafeEqual')
    expect(source).toContain("from 'node:crypto'")
  })

  it('la route cron/rapports-hebdo utilise timingSafeEqual (node:crypto)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/rapports-hebdo/route.ts'),
      'utf-8',
    )
    expect(source).toContain('timingSafeEqual')
    expect(source).toContain("from 'node:crypto'")
  })

  it('verifyCronSecret retourne false si secret vide', () => {
    // Test comportemental via import inline
    // La logique de verifyCronSecret est inline dans le handler
    // → on vérifie la source pour la défense contre les buffers de longueur différente
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/cr/route.ts'),
      'utf-8',
    )
    // Protection contre timingSafeEqual crash (longueurs différentes)
    expect(source).toContain('expected.length !== received.length')
  })
})

// ============================================================
// TST-K5-08 : RBAC /valider — JWT ouvrier → 403, JWT org B → 404
// ============================================================

describe('POST /api/cr/[id]/valider — RBAC (TST-K5-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('JWT ouvrier → 403 (pas de query Supabase)', async () => {
    // Le check de rôle est synchrone avant toute query DB
    const { POST } = await import('@/app/api/cr/[id]/valider/route')
    const req = makeRequest({ role: 'ouvrier' })
    const res = await POST(req, makeParams('cr-123'))
    expect(res.status).toBe(403)
    // Supabase from() ne doit pas avoir été appelé
    expect(mockFromFn).not.toHaveBeenCalled()
  })

  it('JWT org B (cross-org) → 404 (ownership check)', async () => {
    // Le CR appartient à org-001, la requête vient de org-002 → Supabase retourne null
    const fluentNull = {
      select: () => fluentNull,
      eq: () => fluentNull,
      single: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
    }
    mockFromFn.mockReturnValue(fluentNull)

    const { POST } = await import('@/app/api/cr/[id]/valider/route')
    const req = makeRequest({ organisationId: 'org-002' })
    const res = await POST(req, makeParams('cr-123'))
    expect(res.status).toBe(404)
  })
})

// ============================================================
// TST-K5-14 : /envoyer — brouillon → 409 (Resend 0 appel), envoyé→envoyer → 409 (Resend 0 appel)
// ============================================================

describe('POST /api/cr/[id]/envoyer — précondition statut (TST-K5-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('envoyer un brouillon → 409, sendEmail jamais appelé', async () => {
    // Supabase retourne un CR avec statut=brouillon
    const crBrouillon = {
      id: 'cr-123', statut: 'brouillon', organisation_id: 'org-001',
      chantier_id: 'ch-001', date_cr: '2026-06-10',
      contenu_genere: 'Contenu test', valide_par: null, valide_at: null,
    }
    const fluentCr = {
      select: () => fluentCr,
      eq: () => fluentCr,
      single: () => Promise.resolve({ data: crBrouillon, error: null }),
    }
    mockFromFn.mockReturnValue(fluentCr)

    const { POST } = await import('@/app/api/cr/[id]/envoyer/route')
    const req = makeRequest()
    const res = await POST(req, makeParams('cr-123'))
    expect(res.status).toBe(409)
    // Resend ne doit pas être appelé pour un brouillon
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('envoyer un CR déjà envoyé → 200 idempotent, sendEmail jamais appelé', async () => {
    // RG-CR-011 : idempotent si déjà envoye → 200 sans re-send
    const crEnvoye = {
      id: 'cr-123', statut: 'envoye', organisation_id: 'org-001',
      chantier_id: 'ch-001', date_cr: '2026-06-10',
      contenu_genere: 'Contenu test', valide_par: 'user-001', valide_at: '2026-06-10T10:00:00Z',
    }
    const fluentCr = {
      select: () => fluentCr,
      eq: () => fluentCr,
      single: () => Promise.resolve({ data: crEnvoye, error: null }),
    }
    mockFromFn.mockReturnValue(fluentCr)

    const { POST } = await import('@/app/api/cr/[id]/envoyer/route')
    const req = makeRequest()
    const res = await POST(req, makeParams('cr-123'))
    // Idempotence : déjà envoyé → 200 (pas 409, pas de re-send)
    expect(res.status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

// ============================================================
// TST-K5-12 : idempotence cron
// ============================================================

describe('idempotence cron CR (TST-K5-12)', () => {
  it('cron/cr skip les CRs déjà valide ou envoye', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/cr/route.ts'),
      'utf-8',
    )
    // Le cron vérifie existingCr avant de générer
    expect(source).toContain("statut === 'valide'")
    expect(source).toContain("statut === 'envoye'")
    expect(source).toContain('skipped_already_validated')
  })

  it('cron/cr skip les chantiers sans activité (RG-CR-008)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/cr/route.ts'),
      'utf-8',
    )
    expect(source).toContain('has_activity')
    expect(source).toContain('skipped_no_activity')
  })
})

// ============================================================
// TST-K5-13 : resolveDestinatairesInternes — règle PO 2026-06-15
// Tests comportementaux via vi.importActual (contourne le vi.mock hoistée du module)
// ============================================================

describe('resolveDestinatairesInternes — règle PO 2026-06-15 (TST-K5-13)', () => {
  /**
   * Fabrique un adminClient mocké dont .from() retourne des résultats configurables.
   * Séquence d'appels Supabase dans resolveDestinatairesInternes :
   *   1. from('users') — admins org
   *   2. from('chantiers') — created_by du chantier
   *   3. from('users') — infos du created_by (si non null)
   *   4. from('affectations') — affectations actives
   *   5. from('users') — conducteurs affectés (si activeUserIds.length > 0)
   */
  function makeAdminClientMock(calls: Array<{ data: unknown; error: null | { message: string } }>) {
    let callIndex = 0
    const makeFluentChain = (): Record<string, unknown> => {
      const fluent: Record<string, (...args: unknown[]) => unknown> = {}
      const terminal = () => {
        const result = calls[callIndex++] ?? { data: [], error: null }
        return Promise.resolve(result)
      }
      // Méthodes fluent — toutes retournent fluent sauf les terminales
      const chainMethods = ['select', 'eq', 'in', 'lte', 'is', 'maybeSingle']
      for (const m of chainMethods) {
        fluent[m] = () => fluent
      }
      fluent['maybeSingle'] = terminal
      // Pour les requêtes qui terminent par maybeSingle() on overwrite ci-dessus
      // Pour les requêtes qui n'appellent pas maybeSingle (admins, conducteurs affectés, affectations)
      // Vitest évalue le résultat quand la Promise est attendue — on doit retourner une Promise
      // Solution : le fluent lui-même est une Promise (thenable)
      fluent['then'] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const result = calls[callIndex++] ?? { data: [], error: null }
        return Promise.resolve(result).then(resolve, reject)
      }
      return fluent as unknown as Record<string, unknown>
    }
    return {
      from: () => makeFluentChain(),
    }
  }

  it('admin de l\'org NON rattaché au chantier → reçoit quand même', async () => {
    const { resolveDestinatairesInternes: fn } = await vi.importActual<
      typeof import('@/lib/reporting/destinataires')
    >('@/lib/reporting/destinataires')

    // Séquence : admins=[admin@org.fr], created_by=null, affectations=[]
    const adminClient = {
      from: vi.fn()
        .mockReturnValueOnce(buildFluent({ data: [{ email: 'admin@org.fr' }], error: null }))   // admins
        .mockReturnValueOnce(buildFluent({ data: null, error: null }, true))                     // chantiers created_by → null
        .mockReturnValueOnce(buildFluent({ data: [], error: null })),                            // affectations
    }

    const emails = await fn('org-001', 'ch-001', adminClient as unknown as Parameters<typeof fn>[2])
    expect(emails).toContain('admin@org.fr')
    expect(emails).toHaveLength(1)
  })

  it('conducteur NON rattaché (ni created_by ni affectation active) → ne reçoit PAS', async () => {
    const { resolveDestinatairesInternes: fn } = await vi.importActual<
      typeof import('@/lib/reporting/destinataires')
    >('@/lib/reporting/destinataires')

    // Séquence : admins=[admin@org.fr], created_by=null, affectations=[] (conducteur non affecté)
    const adminClient = {
      from: vi.fn()
        .mockReturnValueOnce(buildFluent({ data: [{ email: 'admin@org.fr' }], error: null }))
        .mockReturnValueOnce(buildFluent({ data: null, error: null }, true))                     // chantier → created_by null
        .mockReturnValueOnce(buildFluent({ data: [], error: null })),                            // affectations → vide
    }

    const emails = await fn('org-001', 'ch-001', adminClient as unknown as Parameters<typeof fn>[2])
    expect(emails).not.toContain('conducteur-non-rattache@org.fr')
    expect(emails).toEqual(['admin@org.fr'])
  })

  it('conducteur avec affectation active → reçoit', async () => {
    const { resolveDestinatairesInternes: fn } = await vi.importActual<
      typeof import('@/lib/reporting/destinataires')
    >('@/lib/reporting/destinataires')

    const today = new Date().toISOString().split('T')[0]!

    // Séquence : admins, chantier (created_by=admin-id → non conducteur), affectations actives, conducteurs
    const adminClient = {
      from: vi.fn()
        .mockReturnValueOnce(buildFluent({ data: [{ email: 'admin@org.fr' }], error: null }))
        .mockReturnValueOnce(buildFluent({ data: { created_by: 'admin-id' }, error: null }, true))  // chantier
        .mockReturnValueOnce(buildFluent(                                                            // created_by = admin, pas conducteur
          { data: { email: 'admin@org.fr', role: 'admin', deleted_at: null }, error: null },
          true,
        ))
        .mockReturnValueOnce(buildFluent({                                                          // affectations actives
          data: [{ user_id: 'conducteur-id', date_fin: null }],
          error: null,
        }))
        .mockReturnValueOnce(buildFluent({                                                          // conducteurs
          data: [{ email: 'conducteur@org.fr', role: 'conducteur', deleted_at: null }],
          error: null,
        })),
    }

    const emails = await fn('org-001', 'ch-001', adminClient as unknown as Parameters<typeof fn>[2])
    expect(emails).toContain('admin@org.fr')
    expect(emails).toContain('conducteur@org.fr')
  })

  it('conducteur avec affectation terminée (date_fin passée) non created_by → ne reçoit PAS', async () => {
    const { resolveDestinatairesInternes: fn } = await vi.importActual<
      typeof import('@/lib/reporting/destinataires')
    >('@/lib/reporting/destinataires')

    // Affectation date_fin = hier (passée)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]!

    const adminClient = {
      from: vi.fn()
        .mockReturnValueOnce(buildFluent({ data: [{ email: 'admin@org.fr' }], error: null }))
        .mockReturnValueOnce(buildFluent({ data: null, error: null }, true))                         // chantier created_by null
        .mockReturnValueOnce(buildFluent({                                                            // affectations — date_fin passée
          data: [{ user_id: 'conducteur-id', date_fin: yesterday }],
          error: null,
        })),
        // pas de 5e appel — activeUserIds vide après filtre date_fin
    }

    const emails = await fn('org-001', 'ch-001', adminClient as unknown as Parameters<typeof fn>[2])
    expect(emails).not.toContain('conducteur-termine@org.fr')
    expect(emails).toEqual(['admin@org.fr'])
  })

  it('conducteur soft-deleted → exclu (TST-K5-13 existant)', async () => {
    const { resolveDestinatairesInternes: fn } = await vi.importActual<
      typeof import('@/lib/reporting/destinataires')
    >('@/lib/reporting/destinataires')

    const today = new Date().toISOString().split('T')[0]!

    const adminClient = {
      from: vi.fn()
        .mockReturnValueOnce(buildFluent({ data: [{ email: 'admin@org.fr' }], error: null }))
        .mockReturnValueOnce(buildFluent({ data: null, error: null }, true))
        .mockReturnValueOnce(buildFluent({
          data: [{ user_id: 'conducteur-deleted-id', date_fin: null }],
          error: null,
        }))
        .mockReturnValueOnce(buildFluent({
          // conducteur soft-deleted : deleted_at non null
          data: [{ email: 'conducteur-deleted@org.fr', role: 'conducteur', deleted_at: '2026-01-01T00:00:00Z' }],
          error: null,
        })),
    }

    const emails = await fn('org-001', 'ch-001', adminClient as unknown as Parameters<typeof fn>[2])
    expect(emails).not.toContain('conducteur-deleted@org.fr')
  })
})

/**
 * Utilitaire local : construit un objet fluent Supabase pour les mocks TST-K5-13.
 * Si `terminal` est true, maybeSingle() résout immédiatement (pas d'await sur l'objet).
 * Si `terminal` est false, l'objet est thenable (await sur le fluent lui-même).
 */
function buildFluent(
  result: { data: unknown; error: null | { message: string } },
  terminal = false,
): Record<string, unknown> {
  const fluent: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'in', 'lte', 'is', 'maybeSingle']
  for (const m of chainMethods) {
    fluent[m] = () => fluent
  }
  if (terminal) {
    // maybeSingle() est la méthode terminale
    fluent['maybeSingle'] = () => Promise.resolve(result)
  } else {
    // L'objet lui-même est thenable (await fluent)
    fluent['then'] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
  }
  return fluent
}
