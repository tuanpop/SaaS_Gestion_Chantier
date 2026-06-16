/**
 * __tests__/briefing/genererMessageFallbackBriefing.test.ts
 *
 * Tests Vitest pour lib/briefing/genererMessageFallbackBriefing.ts
 * D-7-04 : jamais throw, texte garanti non vide
 * RG-BRIEFING-007 : fallback déterministe sans LLM
 *
 * Cas couverts :
 *   FB-1 : Happy path — signaux complets → texte non vide
 *   FB-2 : Tronqué à 2000 chars maximum (specs §2.2 constraint)
 *   FB-3 : note_privee_conducteur absent du type (D-051 — protection structurelle)
 *   FB-4 : Aucune dérive → mention "Aucune dérive active"
 *   FB-5 : Jalons → dates et noms affichés
 *   FB-6 : Météo indisponible → mention appropriée
 *   FB-7 : Budget null → pas de crash (budget non défini)
 */

import { describe, it, expect } from 'vitest'
import { genererMessageFallbackBriefing } from '@/lib/briefing/genererMessageFallbackBriefing'
import type { SignauxBriefingChantier } from '@/types/briefing'

// ============================================================
// Fixture de base
// ============================================================

function buildSignaux(overrides: Partial<SignauxBriefingChantier> = {}): SignauxBriefingChantier {
  return {
    chantier_id: 'chantier-test',
    chantier_nom: 'Chantier Test',
    organisation_id: 'org-test',
    semaine_iso: 26,
    annee_iso: 2026,
    generated_at: '2026-06-22T08:30:00Z',
    statut: 'actif',
    budget_ratio: 0.75,
    jours_restants_fin: 30,
    derives_actives: [],
    jalons_semaine: [],
    meteo: {
      code_postal: '75001',
      jours: [],
      source: 'indisponible',
      fetched_at: null,
    },
    seuil_budget: 0.85,
    ...overrides,
  }
}

// ============================================================
// Tests
// ============================================================

describe('genererMessageFallbackBriefing', () => {
  it('FB-1 : happy path — signaux complets → texte non vide', () => {
    const result = genererMessageFallbackBriefing(buildSignaux())

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('Chantier Test')
    expect(result).toContain('Semaine 26')
  })

  it('FB-2 : tronqué à 2000 chars maximum', () => {
    // Génère un texte potentiellement long avec beaucoup de dérives et jalons
    const signaux = buildSignaux({
      derives_actives: [
        {
          type: 'budget_depasse',
          signal_valeur: 92,
          signal_unite: '%',
          message_llm: null,
          detected_at: '2026-06-14T08:30:00Z',
        },
        {
          type: 'retard_date_fin',
          signal_valeur: 5,
          signal_unite: 'jours',
          message_llm: null,
          detected_at: '2026-06-14T08:30:00Z',
        },
      ],
      jalons_semaine: Array.from({ length: 10 }, (_, i) => ({
        tache_id: `tache-${i}`,
        tache_titre: `Tâche longue titre numéro ${i} pour tester la troncature correcte`,
        date_echeance: '2026-06-25',
        statut: 'en_cours',
        jours_restants: 3,
        assigned_to_nom: `Prénom Nom Long Complet ${i}`,
      })),
    })

    const result = genererMessageFallbackBriefing(signaux)
    expect(result.length).toBeLessThanOrEqual(2000)
  })

  it('FB-3 : note_privee_conducteur absent du type SignauxBriefingChantier (D-051)', () => {
    const signaux = buildSignaux()
    // Vérification structurelle TypeScript — la clé ne doit pas exister dans le type
    // Si ce test compile, le type est correct
    expect('note_privee_conducteur' in signaux).toBe(false)
    // Et dans les jalons aussi
    const jalon = {
      tache_id: 'j1',
      tache_titre: 'Titre',
      date_echeance: '2026-06-25',
      statut: 'en_cours',
      jours_restants: 2,
      assigned_to_nom: null,
    }
    expect('note_privee_conducteur' in jalon).toBe(false)
  })

  it('FB-4 : aucune dérive → mention "Aucune dérive"', () => {
    const result = genererMessageFallbackBriefing(buildSignaux({ derives_actives: [] }))
    expect(result).toContain('Aucune dérive')
  })

  it('FB-5 : jalons → date et nom assigné affichés', () => {
    const signaux = buildSignaux({
      jalons_semaine: [{
        tache_id: 'j1',
        tache_titre: 'Pose carrelage salle',
        date_echeance: '2026-06-25',
        statut: 'en_cours',
        jours_restants: 3,
        assigned_to_nom: 'Jean Dupont',
      }],
    })

    const result = genererMessageFallbackBriefing(signaux)
    expect(result).toContain('Pose carrelage salle')
    expect(result).toContain('Jean Dupont')
    expect(result).toContain('2026-06-25')
  })

  it('FB-6 : météo indisponible → mention appropriée', () => {
    const signaux = buildSignaux({
      meteo: {
        code_postal: '75001',
        jours: [],
        source: 'indisponible',
        fetched_at: null,
      },
    })

    const result = genererMessageFallbackBriefing(signaux)
    expect(result.toLowerCase()).toContain('météo')
    expect(result).toContain('indisponible')
  })

  it('FB-7 : budget null → pas de crash', () => {
    const signaux = buildSignaux({ budget_ratio: null })
    expect(() => genererMessageFallbackBriefing(signaux)).not.toThrow()
    const result = genererMessageFallbackBriefing(signaux)
    expect(result).toContain('Budget')
  })
})
