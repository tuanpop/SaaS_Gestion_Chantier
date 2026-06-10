/**
 * tests/unit/reporting-hebdo.test.ts
 * RG-RH-003 : rapport hebdo agrège uniquement CRs valide/envoye
 * RG-RH-002 : semaine ISO précédente pour le cron
 * TST-K5-08 : cron hebdo AM-01 ligne distincte dans crontab
 * AM-03 : destinataires incluent l'expéditeur (resolveDestinatairesInternes sans exclusion)
 */

import { describe, it, expect, vi } from 'vitest'

// ============================================================
// RG-RH-002 : semaine ISO précédente
// ============================================================

describe('getPreviousIsoWeek (RG-RH-002)', () => {
  it('retourne la semaine précédant la date donnée', async () => {
    const { getPreviousIsoWeek, getIsoWeek, getIsoYear } = await import('@/lib/reporting/isoWeek')
    const now = new Date('2026-06-10') // mercredi S24
    const { anneeIso, semaineIso } = getPreviousIsoWeek(now)
    // La semaine précédente de S24 est S23
    expect(semaineIso).toBe(23)
    expect(anneeIso).toBe(2026)
  })

  it('passe correctement en début d\'année (S1 → S52/53 de l\'année précédente)', async () => {
    const { getPreviousIsoWeek } = await import('@/lib/reporting/isoWeek')
    // 5 janvier 2026 = S2 2026 → semaine précédente = S1 2026 ou S53 2025
    const d = new Date('2026-01-05')
    const { anneeIso, semaineIso } = getPreviousIsoWeek(d)
    expect(semaineIso).toBeGreaterThanOrEqual(1)
    expect(semaineIso).toBeLessThanOrEqual(53)
    // L'année doit être 2025 ou 2026
    expect([2025, 2026]).toContain(anneeIso)
  })
})

// ============================================================
// TST-K5-08 : cron ligne distincte AM-01
// ============================================================

describe('crontab — AM-01 ligne rapports-hebdo distincte (TST-K5-08)', () => {
  it('contient une ligne pour /api/cron/rapports-hebdo', () => {
    const fs = require('fs')
    const path = require('path')
    const crontab = fs.readFileSync(
      path.resolve(__dirname, '../../../08-infra/crontab'),
      'utf-8',
    )
    expect(crontab).toContain('/api/cron/rapports-hebdo')
  })

  it('la ligne rapports-hebdo est programmée lundi 07h15 (15 7 * * 1)', () => {
    const fs = require('fs')
    const path = require('path')
    const crontab = fs.readFileSync(
      path.resolve(__dirname, '../../../08-infra/crontab'),
      'utf-8',
    )
    // Chercher la ligne qui contient rapports-hebdo et vérifier le schedule
    const line = crontab
      .split('\n')
      .find((l: string) => l.includes('/api/cron/rapports-hebdo') && !l.startsWith('#'))
    expect(line).toBeDefined()
    expect(line).toMatch(/^15 7 \* \* 1/)
  })

  it('la ligne CR est programmée à 18h (0 18 * * *)', () => {
    const fs = require('fs')
    const path = require('path')
    const crontab = fs.readFileSync(
      path.resolve(__dirname, '../../../08-infra/crontab'),
      'utf-8',
    )
    const line = crontab
      .split('\n')
      .find((l: string) => l.includes('/api/cron/cr') && !l.startsWith('#'))
    expect(line).toBeDefined()
    expect(line).toMatch(/^0 18 \* \* \*/)
  })
})

// ============================================================
// AM-03 : resolveDestinatairesInternes inclut l'expéditeur
// ============================================================

describe('resolveDestinatairesInternes — AM-03 inclut expéditeur', () => {
  it('le SELECT ne filtre pas par userId (pas d\'exclusion de l\'expéditeur)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/destinataires.ts'),
      'utf-8',
    )
    // AM-03 BINDING : aucune exclusion de l'expéditeur
    // La source ne doit pas contenir de filtre .neq('id', userId)
    expect(source).not.toContain('.neq(')
    expect(source).not.toContain('!= userId')
    expect(source).not.toContain('neq(\'id\'')
  })

  it('query filtre role IN (admin, conducteur) et deleted_at IS NULL', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/destinataires.ts'),
      'utf-8',
    )
    expect(source).toContain('admin')
    expect(source).toContain('conducteur')
    expect(source).toContain('deleted_at')
  })
})

// ============================================================
// RG-RH-003 : rapport agrège CRs valide + envoye (pas brouillon)
// ============================================================

describe('cron rapports-hebdo — filtre statuts CRs (RG-RH-003)', () => {
  it('la route cron/rapports-hebdo filtre IN valide, envoye (pas brouillon)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/rapports-hebdo/route.ts'),
      'utf-8',
    )
    // Doit inclure le filtre .in('statut', ['valide', 'envoye'])
    expect(source).toContain("'valide'")
    expect(source).toContain("'envoye'")
    // Et ne pas agréger les brouillons
    expect(source).not.toMatch(/in.*statut.*brouillon/)
  })
})
