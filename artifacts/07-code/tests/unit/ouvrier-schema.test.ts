/**
 * tests/unit/ouvrier-schema.test.ts
 * Tests unitaires schemas Zod ouvrier
 *
 * Scenarios couverts :
 *   - PatchOuvrierTacheSchema.strict() rejette note_privee_conducteur (K3-CR-04 BINDING)
 *   - bloque_raison min 3 chars (specs ouvrier §4.5 — distinct du conducteur min 10)
 *   - transitions statut valides
 *   - OuvrierSessionSchema valide les sessions correctes
 *   - OuvrierSessionSchema rejette les sessions avec role != ouvrier
 *   - NoAffectationDataSchema valide et rejette
 */

import { describe, it, expect } from 'vitest'
import {
  PatchOuvrierTacheSchema,
  OuvrierSessionSchema,
  NoAffectationDataSchema,
} from '../../lib/validation/ouvrier'

// ============================================================
// PatchOuvrierTacheSchema
// ============================================================

describe('PatchOuvrierTacheSchema — D-3-022 .strict()', () => {
  it('accepte un statut valide sans bloque_raison', () => {
    const result = PatchOuvrierTacheSchema.safeParse({ statut: 'en_cours' })
    expect(result.success).toBe(true)
  })

  it('accepte statut bloque avec bloque_raison >= 3 chars', () => {
    const result = PatchOuvrierTacheSchema.safeParse({
      statut: 'bloque',
      bloque_raison: 'abc',
    })
    expect(result.success).toBe(true)
  })

  it('accepte statut termine', () => {
    const result = PatchOuvrierTacheSchema.safeParse({ statut: 'termine' })
    expect(result.success).toBe(true)
  })

  it('rejette bloque_raison < 3 chars', () => {
    const result = PatchOuvrierTacheSchema.safeParse({
      statut: 'bloque',
      bloque_raison: 'ab',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(JSON.stringify(result.error.flatten())).toContain('bloque_raison')
    }
  })

  it('K3-CR-04 BINDING : rejette note_privee_conducteur (champ inconnu)', () => {
    // .strict() doit rejeter tout champ non declare
    const result = PatchOuvrierTacheSchema.safeParse({
      statut: 'en_cours',
      note_privee_conducteur: 'tentative injection',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      // Zod strict() place l'erreur dans les issues avec code 'unrecognized_keys'
      // Le message peut etre "Unrecognized key(s)..." ou similaire selon la version
      const hasUnrecognizedKeyError = result.error.issues.some(
        (i) => i.code === 'unrecognized_keys' || i.message.toLowerCase().includes('unrecognized'),
      )
      expect(hasUnrecognizedKeyError).toBe(true)
    }
  })

  it('rejette un champ completement inconnu', () => {
    const result = PatchOuvrierTacheSchema.safeParse({
      statut: 'en_cours',
      unknown_field: 'hack',
    })
    expect(result.success).toBe(false)
  })

  it('rejette un statut invalide', () => {
    const result = PatchOuvrierTacheSchema.safeParse({
      statut: 'annule', // non dans l'enum
    })
    expect(result.success).toBe(false)
  })

  it('rejette bloque_raison > 1000 chars', () => {
    const result = PatchOuvrierTacheSchema.safeParse({
      statut: 'bloque',
      bloque_raison: 'a'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// OuvrierSessionSchema
// ============================================================

describe('OuvrierSessionSchema', () => {
  const VALID_SESSION = {
    user_id: '00000000-0000-0000-0000-000000000001',
    organisation_id: '00000000-0000-0000-0000-000000000002',
    role: 'ouvrier',
    affectations: [
      {
        affectation_id: '00000000-0000-0000-0000-000000000003',
        chantier_id: '00000000-0000-0000-0000-000000000004',
        vue: 'mes_taches',
      },
    ],
    created_at: Date.now(),
  }

  it('accepte une session valide', () => {
    const result = OuvrierSessionSchema.safeParse(VALID_SESSION)
    expect(result.success).toBe(true)
  })

  it('accepte affectations vide (ouvrier sans affectation active)', () => {
    const result = OuvrierSessionSchema.safeParse({ ...VALID_SESSION, affectations: [] })
    expect(result.success).toBe(true)
  })

  it('rejette role != ouvrier', () => {
    const result = OuvrierSessionSchema.safeParse({ ...VALID_SESSION, role: 'conducteur' })
    expect(result.success).toBe(false)
  })

  it('rejette user_id non-UUID', () => {
    const result = OuvrierSessionSchema.safeParse({ ...VALID_SESSION, user_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejette created_at negatif', () => {
    const result = OuvrierSessionSchema.safeParse({ ...VALID_SESSION, created_at: -1 })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// NoAffectationDataSchema
// ============================================================

describe('NoAffectationDataSchema', () => {
  it('accepte des donnees valides avec telephone', () => {
    const result = NoAffectationDataSchema.safeParse({
      conducteur_nom: 'Dupont',
      conducteur_prenom: 'Jean',
      conducteur_telephone: '+33601020304',
      dernier_chantier_nom: 'Chantier Alpha',
    })
    expect(result.success).toBe(true)
  })

  it('accepte telephone null', () => {
    const result = NoAffectationDataSchema.safeParse({
      conducteur_nom: 'Dupont',
      conducteur_prenom: 'Jean',
      conducteur_telephone: null,
      dernier_chantier_nom: 'Chantier Alpha',
    })
    expect(result.success).toBe(true)
  })

  it('rejette conducteur_nom vide', () => {
    const result = NoAffectationDataSchema.safeParse({
      conducteur_nom: '',
      conducteur_prenom: 'Jean',
      conducteur_telephone: null,
      dernier_chantier_nom: 'Chantier Alpha',
    })
    expect(result.success).toBe(false)
  })
})
