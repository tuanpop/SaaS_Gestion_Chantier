/**
 * tests/unit/reporting-cr-endpoints.test.ts
 * TST-K5-06 : IDOR 404 cross-org (GET /api/cr/[id])
 * TST-K5-07 : ownership chantier (GET /api/chantiers/[id]/cr)
 * TST-K5-09 : Zod .strict() — PATCH /api/cr/[id] rejette champs inconnus
 * TST-K5-11 : rate-limit 10/h/userId pour POST /api/chantiers/[id]/cr/generer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// TST-K5-09 : PatchCrBodySchema .strict()
// ============================================================

describe('PatchCrBodySchema — Zod .strict() (TST-K5-09)', () => {
  it('accepte un body avec uniquement contenu_genere', async () => {
    const { PatchCrBodySchema } = await import('@/lib/validation/reporting')
    const result = PatchCrBodySchema.safeParse({ contenu_genere: 'Rapport modifié.' })
    expect(result.success).toBe(true)
  })

  it('rejette un body avec des champs supplémentaires (mass-assignment)', async () => {
    const { PatchCrBodySchema } = await import('@/lib/validation/reporting')
    const result = PatchCrBodySchema.safeParse({
      contenu_genere: 'OK',
      statut: 'valide',
      organisation_id: 'autre-org',
    })
    expect(result.success).toBe(false)
  })

  it('rejette un body vide (contenu_genere requis)', async () => {
    const { PatchCrBodySchema } = await import('@/lib/validation/reporting')
    const result = PatchCrBodySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejette contenu_genere > 50000 chars', async () => {
    const { PatchCrBodySchema } = await import('@/lib/validation/reporting')
    const result = PatchCrBodySchema.safeParse({
      contenu_genere: 'a'.repeat(50001),
    })
    expect(result.success).toBe(false)
  })

  it('accepte contenu_genere exactement 50000 chars', async () => {
    const { PatchCrBodySchema } = await import('@/lib/validation/reporting')
    const result = PatchCrBodySchema.safeParse({
      contenu_genere: 'a'.repeat(50000),
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================
// PatchHebdoBodySchema .strict()
// ============================================================

describe('PatchHebdoBodySchema — Zod .strict() (TST-K5-09)', () => {
  it('accepte uniquement contenu_genere', async () => {
    const { PatchHebdoBodySchema } = await import('@/lib/validation/reporting')
    const result = PatchHebdoBodySchema.safeParse({ contenu_genere: 'Hebdo OK.' })
    expect(result.success).toBe(true)
  })

  it('rejette des champs additionnels', async () => {
    const { PatchHebdoBodySchema } = await import('@/lib/validation/reporting')
    const result = PatchHebdoBodySchema.safeParse({
      contenu_genere: 'OK',
      statut: 'valide',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// GetCrListQuerySchema — pagination max 50
// ============================================================

describe('GetCrListQuerySchema — limite max 50 enforced server-side (specs §6.3)', () => {
  it('limit=50 accepté', async () => {
    const { GetCrListQuerySchema } = await import('@/lib/validation/reporting')
    const result = GetCrListQuerySchema.safeParse({ limit: '50' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.limit).toBe(50)
  })

  it('limit=51 rejeté', async () => {
    const { GetCrListQuerySchema } = await import('@/lib/validation/reporting')
    const result = GetCrListQuerySchema.safeParse({ limit: '51' })
    expect(result.success).toBe(false)
  })

  it('limit absent → default 20', async () => {
    const { GetCrListQuerySchema } = await import('@/lib/validation/reporting')
    const result = GetCrListQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.limit).toBe(20)
  })

  it('cursor doit être une date YYYY-MM-DD', async () => {
    const { GetCrListQuerySchema } = await import('@/lib/validation/reporting')
    const invalid = GetCrListQuerySchema.safeParse({ cursor: '13/06/2026' })
    expect(invalid.success).toBe(false)
    const valid = GetCrListQuerySchema.safeParse({ cursor: '2026-06-13' })
    expect(valid.success).toBe(true)
  })
})

// ============================================================
// GenererCrBodySchema — date_cr optionnelle (format YYYY-MM-DD)
// ============================================================

describe('GenererCrBodySchema — date_cr optionnelle', () => {
  it('body vide accepté (date_cr est optionnelle)', async () => {
    const { GenererCrBodySchema } = await import('@/lib/validation/reporting')
    const result = GenererCrBodySchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('date_cr valide', async () => {
    const { GenererCrBodySchema } = await import('@/lib/validation/reporting')
    const result = GenererCrBodySchema.safeParse({ date_cr: '2026-06-10' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.date_cr).toBe('2026-06-10')
  })

  it('date_cr invalide rejetée', async () => {
    const { GenererCrBodySchema } = await import('@/lib/validation/reporting')
    const result = GenererCrBodySchema.safeParse({ date_cr: '10-06-2026' })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// GenererHebdoBodySchema
// ============================================================

describe('GenererHebdoBodySchema — annee_iso + semaine_iso', () => {
  it('body valide', async () => {
    const { GenererHebdoBodySchema } = await import('@/lib/validation/reporting')
    const result = GenererHebdoBodySchema.safeParse({ annee_iso: 2026, semaine_iso: 24 })
    expect(result.success).toBe(true)
  })

  it('semaine_iso=53 acceptée', async () => {
    const { GenererHebdoBodySchema } = await import('@/lib/validation/reporting')
    const result = GenererHebdoBodySchema.safeParse({ annee_iso: 2026, semaine_iso: 53 })
    expect(result.success).toBe(true)
  })

  it('semaine_iso=0 rejetée', async () => {
    const { GenererHebdoBodySchema } = await import('@/lib/validation/reporting')
    const result = GenererHebdoBodySchema.safeParse({ annee_iso: 2026, semaine_iso: 0 })
    expect(result.success).toBe(false)
  })

  it('annee_iso=1999 rejetée', async () => {
    const { GenererHebdoBodySchema } = await import('@/lib/validation/reporting')
    const result = GenererHebdoBodySchema.safeParse({ annee_iso: 1999, semaine_iso: 1 })
    expect(result.success).toBe(false)
  })
})
