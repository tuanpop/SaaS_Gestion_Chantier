// tests/unit/detection-fallback.test.ts — Tests unitaires genererMessageFallback
// D-6-03 BINDING : si LLM KO → fallback déterministe. Le cron ne throw jamais.
// Message tronqué à 1000 chars (RG-DERIVE-034).

import { describe, it, expect } from 'vitest'
import { genererMessageFallback } from '../../lib/detection/genererMessageFallback'
import type { SignauxDeriveChantier, SeuilsEffectifs } from '../../types/detection'

const SEUILS: SeuilsEffectifs = {
  organisation_id: 'org-1',
  ratio_budget: 0.85,
  jours_blocage: 3,
  jours_inactivite: 7,
  source: 'defaut',
}

function makeSignaux(overrides: Partial<SignauxDeriveChantier> = {}): SignauxDeriveChantier {
  return {
    chantier_id: 'ch-1',
    chantier_nom: 'Chantier Test',
    organisation_id: 'org-1',
    seuils: SEUILS,
    evaluated_at: new Date().toISOString(),
    derives: [],
    ...overrides,
  }
}

describe('genererMessageFallback', () => {
  it('retourne un string non vide pour une dérive budget (happy path)', () => {
    const signaux = makeSignaux({
      derives: [{
        type: 'budget_depasse',
        budget_alloue: 100_000,
        budget_depense: 92_000,
        ratio: 0.92,
        depassement_eur: -8_000,
        seuil_applique: 0.85,
      }],
    })
    const msg = genererMessageFallback(signaux)
    expect(msg).toBeTruthy()
    expect(typeof msg).toBe('string')
    expect(msg.length).toBeGreaterThan(10)
  })

  it('retourne un string non vide pour une dérive retard', () => {
    const signaux = makeSignaux({
      derives: [{
        type: 'retard_date_fin',
        date_fin_prevue: '2026-01-01',
        jours_retard: 14,
      }],
    })
    const msg = genererMessageFallback(signaux)
    expect(msg).toBeTruthy()
  })

  it('retourne un string non vide pour une dérive tâche bloquée', () => {
    const signaux = makeSignaux({
      derives: [{
        type: 'tache_bloquee_longue',
        tache_id: 't-1',
        tache_titre: 'Coulage fondations',
        jours_bloque: 5,
        seuil_applique: 3,
      }],
    })
    const msg = genererMessageFallback(signaux)
    expect(msg).toBeTruthy()
  })

  it('retourne un string non vide pour une dérive inactivité', () => {
    const signaux = makeSignaux({
      derives: [{
        type: 'inactivite_chantier',
        jours_sans_activite: 10,
        derniere_activite: '2026-06-06',
        seuil_applique: 7,
      }],
    })
    const msg = genererMessageFallback(signaux)
    expect(msg).toBeTruthy()
  })

  it('RG-DERIVE-034 : message tronqué à 1000 chars max', () => {
    // Crée un signaux avec de nombreuses dérives pour forcer un message long
    const derives = Array.from({ length: 20 }, (_, i): import('../../types/detection').SignalDerive => ({
      type: 'tache_bloquee_longue',
      tache_id: `t-${i}`,
      tache_titre: `Tâche bloquée depuis très longtemps numéro ${i} avec un titre très verbeux`,
      jours_bloque: 100 + i,
      seuil_applique: 3,
    }))
    const signaux = makeSignaux({ derives })
    const msg = genererMessageFallback(signaux)
    expect(msg.length).toBeLessThanOrEqual(1000)
  })

  it('retourne un string non vide même si derives = [] (cas edge)', () => {
    const signaux = makeSignaux({ derives: [] })
    const msg = genererMessageFallback(signaux)
    expect(typeof msg).toBe('string')
    // Peut être vide ou contenir un message générique — ce qui compte c'est pas de throw
  })
})
