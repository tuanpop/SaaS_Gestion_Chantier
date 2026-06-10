/**
 * tests/unit/reporting-pdf-filename.test.ts
 * TST-K5-04 : buildCrFilename + buildHebdoFilename produisent des noms sûrs
 * D-5-07 : PDF généré via renderToBuffer (pas de stockage)
 * RG-PDF-001 : 409 si statut=brouillon
 * SURF-5-10 : aucun dangerouslySetInnerHTML dans CrDocument/HebdoDocument
 */

import { describe, it, expect } from 'vitest'

// ============================================================
// TST-K5-04 : sanitizeFilename / buildCrFilename / buildHebdoFilename
// ============================================================

describe('filename — sanitizeFilename (TST-K5-04)', () => {
  it('sanitizeFilename remplace les caractères non-alphanumériques', async () => {
    const { sanitizeFilename } = await import('@/lib/reporting/filename')
    const result = sanitizeFilename('Chantier <Paris> & Co')
    // Caractères < > & remplacés par -
    expect(result).not.toMatch(/[<>&]/)
    expect(result).toBeTruthy()
  })

  it('sanitizeFilename limite la longueur à maxLen', async () => {
    const { sanitizeFilename } = await import('@/lib/reporting/filename')
    const long = 'a'.repeat(200)
    expect(sanitizeFilename(long, 50).length).toBeLessThanOrEqual(50)
  })

  it('sanitizeFilename retourne "document" pour une entrée vide après nettoyage', async () => {
    const { sanitizeFilename } = await import('@/lib/reporting/filename')
    expect(sanitizeFilename('   ')).toBe('document')
  })

  it('sanitizeFilename retire les CR/LF/guillemets (injection chemin)', async () => {
    const { sanitizeFilename } = await import('@/lib/reporting/filename')
    const dangerous = 'fichier\r\n"injection"'
    const result = sanitizeFilename(dangerous)
    expect(result).not.toMatch(/[\r\n"]/)
  })
})

describe('buildCrFilename (TST-K5-04)', () => {
  it('format CR-[chantier]-[date].pdf', async () => {
    const { buildCrFilename } = await import('@/lib/reporting/filename')
    const result = buildCrFilename('Chantier BTP', '2026-06-10')
    expect(result).toMatch(/^CR-.*-2026-06-10\.pdf$/)
  })

  it('sanitise le nom du chantier', async () => {
    const { buildCrFilename } = await import('@/lib/reporting/filename')
    const result = buildCrFilename('Chantier <Script>', '2026-06-10')
    expect(result).not.toMatch(/<|>/)
  })
})

describe('buildHebdoFilename (TST-K5-04)', () => {
  it('format RapportHebdo-[chantier]-S[N]-[AAAA].pdf', async () => {
    const { buildHebdoFilename } = await import('@/lib/reporting/filename')
    const result = buildHebdoFilename('Chantier ABC', 2026, 24)
    expect(result).toMatch(/^RapportHebdo-.*-S24-2026\.pdf$/)
  })
})

// ============================================================
// RG-PDF-001 + SURF-5-10 : vérification structurelle des documents PDF
// ============================================================

describe('CrDocument — SURF-5-10 aucun HTML interpolé', () => {
  it('CrDocument.tsx n\'utilise pas dangerouslySetInnerHTML', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/pdf/CrDocument.tsx'),
      'utf-8',
    )
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })

  it('CrDocument.tsx n\'utilise pas <Image> avec URL externe', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/pdf/CrDocument.tsx'),
      'utf-8',
    )
    // Pas d'<Image src={...}> (SURF-5-10)
    expect(source).not.toMatch(/<Image/)
  })

  it('HebdoDocument.tsx n\'utilise pas dangerouslySetInnerHTML', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/pdf/HebdoDocument.tsx'),
      'utf-8',
    )
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })
})

describe('API PDF — RG-PDF-001 : 409 si brouillon', () => {
  it('route cr/pdf retourne 409 si statut=brouillon', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cr/[id]/pdf/route.ts'),
      'utf-8',
    )
    expect(source).toContain("cr.statut === 'brouillon'")
    expect(source).toContain('409')
  })

  it('route rapports-hebdo/pdf retourne 409 si statut=brouillon', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/rapports-hebdo/[id]/pdf/route.ts'),
      'utf-8',
    )
    expect(source).toContain("rapport.statut === 'brouillon'")
    expect(source).toContain('409')
  })

  it('route cr/pdf utilise renderToBuffer (D-5-07 — pas de stockage)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cr/[id]/pdf/route.ts'),
      'utf-8',
    )
    expect(source).toContain('renderToBuffer')
    // Pas de createSignedUploadUrl ni putObject (pas de stockage)
    expect(source).not.toContain('upload')
    expect(source).not.toContain('storage.from')
  })
})
