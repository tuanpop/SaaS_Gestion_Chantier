// tests/unit/coloration.test.ts
// Vitest — logique coloration déterministe (6 scénarios Gherkin US-010 DoD)
// Testable sans DB : fonctions pures
// Source : SPRINT_2_PLAN.md §F.1

import { describe, it, expect } from 'vitest'
import { calculerCouleur, trierParCouleur } from '@/lib/coloration'
import type { ChantierColoration, CouleurChantier } from '@/lib/coloration'

// ============================================================
// Helper : date string YYYY-MM-DD relative à aujourd'hui
// ============================================================

function dateRelative(joursOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + joursOffset)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateDemain(): string {
  return dateRelative(1)
}

function dateHier(): string {
  return dateRelative(-1)
}

function dateDans30Jours(): string {
  return dateRelative(30)
}

function dateDans2Jours(): string {
  return dateRelative(2)
}

// ============================================================
// Tests
// ============================================================

describe('calculerCouleur', () => {
  /**
   * Scénario 1 (rouge date) :
   * GIVEN date_fin_prevue = hier
   * WHEN calculerCouleur(chantier, aujourd_hui)
   * THEN 'rouge'
   */
  it('Scénario 1 — rouge : date_fin_prevue dépassée', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateHier(),
      budget_alloue: 50000,
      budget_depense: 30000,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('rouge')
  })

  /**
   * Scénario 2 (rouge budget) :
   * GIVEN budget_alloue = 10000, budget_depense = 10001
   * WHEN calculerCouleur(chantier, aujourd_hui)
   * THEN 'rouge'
   */
  it('Scénario 2 — rouge : budget_depense > budget_alloue', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateDans30Jours(),
      budget_alloue: 10000,
      budget_depense: 10001,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('rouge')
  })

  /**
   * Scénario 3 (orange date) :
   * GIVEN date_fin_prevue = aujourd'hui + 2 jours
   * WHEN calculerCouleur(chantier, aujourd_hui)
   * THEN 'orange'
   */
  it('Scénario 3 — orange : date_fin_prevue dans 2 jours (dans les 3 prochains)', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateDans2Jours(),
      budget_alloue: 50000,
      budget_depense: 30000,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('orange')
  })

  /**
   * Scénario 4 (vert) :
   * GIVEN date_fin_prevue = dans 30 jours, budget_depense < budget_alloue
   * WHEN calculerCouleur(chantier, aujourd_hui)
   * THEN 'vert'
   */
  it('Scénario 4 — vert : dans les temps, budget OK', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateDans30Jours(),
      budget_alloue: 50000,
      budget_depense: 30000,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('vert')
  })

  /**
   * Scénario 5 (budget null = vert budget) :
   * GIVEN budget_alloue = null, budget_depense = 99999
   * WHEN calculerCouleur(chantier, aujourd_hui)
   * THEN 'vert'  -- pas de dépassement calculable sans budget_alloue
   */
  it('Scénario 5 — vert : budget_alloue null (pas de dérive calculable)', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateDans30Jours(),
      budget_alloue: null,
      budget_depense: 99999,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('vert')
  })

  /**
   * Scénario additionnel : orange si date_fin_prevue = aujourd'hui (J-0)
   */
  it('orange : date_fin_prevue = aujourd\'hui (J-0)', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateRelative(0),
      budget_alloue: 50000,
      budget_depense: 30000,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('orange')
  })

  /**
   * Scénario additionnel : rouge prime sur orange (dépassement budget + date proche)
   */
  it('rouge prime sur orange : budget dépassé ET date proche', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateDemain(),
      budget_alloue: 10000,
      budget_depense: 12000,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('rouge')
  })

  /**
   * Scénario additionnel : orange si date dans 3 jours exactement
   */
  it('orange : date_fin_prevue dans exactement 3 jours', () => {
    const chantier: ChantierColoration = {
      date_fin_prevue: dateRelative(3),
      budget_alloue: 50000,
      budget_depense: 30000,
    }
    const aujourdhui = new Date()
    expect(calculerCouleur(chantier, aujourdhui)).toBe<CouleurChantier>('orange')
  })
})

describe('trierParCouleur', () => {
  /**
   * Scénario 6 (tri) :
   * GIVEN [chantier_vert, chantier_rouge, chantier_orange]
   * WHEN trierParCouleur(chantiers)
   * THEN [chantier_rouge, chantier_orange, chantier_vert]
   */
  it('Scénario 6 — tri : rouge > orange > vert', () => {
    const chantiers = [
      { id: 'vert', couleur: 'vert' as CouleurChantier, nom: 'Vert' },
      { id: 'rouge', couleur: 'rouge' as CouleurChantier, nom: 'Rouge' },
      { id: 'orange', couleur: 'orange' as CouleurChantier, nom: 'Orange' },
    ]

    const sorted = trierParCouleur(chantiers)

    expect(sorted[0]?.id).toBe('rouge')
    expect(sorted[1]?.id).toBe('orange')
    expect(sorted[2]?.id).toBe('vert')
  })

  it('tri stable : conserve l\'ordre relatif des chantiers de même couleur', () => {
    const chantiers = [
      { id: 'rouge-1', couleur: 'rouge' as CouleurChantier },
      { id: 'vert-1', couleur: 'vert' as CouleurChantier },
      { id: 'rouge-2', couleur: 'rouge' as CouleurChantier },
      { id: 'orange-1', couleur: 'orange' as CouleurChantier },
    ]

    const sorted = trierParCouleur(chantiers)

    // Rouges en premier, dans leur ordre relatif
    expect(sorted[0]?.id).toBe('rouge-1')
    expect(sorted[1]?.id).toBe('rouge-2')
    // Orange ensuite
    expect(sorted[2]?.id).toBe('orange-1')
    // Vert en dernier
    expect(sorted[3]?.id).toBe('vert-1')
  })

  it('ne mute pas le tableau d\'origine', () => {
    const original = [
      { id: 'vert', couleur: 'vert' as CouleurChantier },
      { id: 'rouge', couleur: 'rouge' as CouleurChantier },
    ]
    const originalCopy = [...original]
    trierParCouleur(original)
    expect(original).toEqual(originalCopy)
  })
})
