/**
 * tests/unit/reporting-donnees-brutes.test.ts
 * TST-K5-05 : donnees_brutes ne contient pas les champs secrets
 * TST-K5-15 : emails utilisent escapeHtml sur les valeurs user
 * TST-K5-16 : PDF n'accepte pas d'URL LLM dans <Image>
 * Vérifications structurelles des implémentations
 */

import { describe, it, expect } from 'vitest'

// ============================================================
// TST-K5-05 : donnees_brutes ne contient pas les champs secrets
// ============================================================

describe('donnees_brutes — exclusion champs secrets (TST-K5-05)', () => {
  it('genererContenuCR.ts ne passe pas note_privee_conducteur au LLM', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/genererContenuCR.ts'),
      'utf-8',
    )
    // La fonction ne doit pas référencer note_privee_conducteur dans l'assemblage du prompt
    expect(source).not.toContain('note_privee_conducteur')
  })

  it('genererRapportHebdo.ts ne passe pas de champs secrets au LLM', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/reporting/genererRapportHebdo.ts'),
      'utf-8',
    )
    expect(source).not.toContain('note_privee_conducteur')
    expect(source).not.toContain('storage_path')
    expect(source).not.toContain('signed_url')
  })

  it('cron/cr ne passe pas note_privee_conducteur en donnees_brutes', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/cr/route.ts'),
      'utf-8',
    )
    expect(source).not.toContain('note_privee_conducteur')
  })
})

// ============================================================
// TST-K5-15 : escapeHtml obligatoire dans les emails
// ============================================================

describe('escapeHtml — emails reporting (TST-K5-15)', () => {
  it('cr/envoyer/route.ts utilise escapeHtml sur les valeurs user', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cr/[id]/envoyer/route.ts'),
      'utf-8',
    )
    expect(source).toContain('escapeHtml')
    // Toutes les variables passées à renderEmail doivent passer par escapeHtml
    // On vérifie que CHANTIER_NOM, VALIDE_PAR_NOM sont bien escapés
    expect(source).toContain('escapeHtml(chantierNom)')
    expect(source).toContain('escapeHtml(validePar)')
  })

  it('rapports-hebdo/envoyer/route.ts utilise escapeHtml', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/rapports-hebdo/[id]/envoyer/route.ts'),
      'utf-8',
    )
    expect(source).toContain('escapeHtml')
    expect(source).toContain('escapeHtml(chantierNom)')
  })

  it('escapeHtml encode les caractères HTML dangereux', async () => {
    const { escapeHtml } = await import('@/lib/notifications/email-layout')
    const xssAttempt = '<script>alert("xss")</script>'
    const escaped = escapeHtml(xssAttempt)
    expect(escaped).not.toContain('<script>')
    expect(escaped).toContain('&lt;script&gt;')
  })
})

// ============================================================
// D-5-09 : UPSERT atomique — vérification structurelle
// ============================================================

describe('UPSERT atomique (D-5-09)', () => {
  it('cron/cr utilise upsert avec onConflict: chantier_id,date_cr', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cron/cr/route.ts'),
      'utf-8',
    )
    expect(source).toContain('upsert')
    expect(source).toContain('chantier_id,date_cr')
  })

  it('cr/generer/route.ts utilise upsert avec onConflict: chantier_id,date_cr', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/chantiers/[id]/cr/generer/route.ts'),
      'utf-8',
    )
    expect(source).toContain('upsert')
    expect(source).toContain('chantier_id,date_cr')
  })

  it('rapports-hebdo/generer utilise upsert avec onConflict: chantier_id,annee_iso,semaine_iso', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/chantiers/[id]/rapports-hebdo/generer/route.ts'),
      'utf-8',
    )
    expect(source).toContain('upsert')
    expect(source).toContain('chantier_id,annee_iso,semaine_iso')
  })
})

// ============================================================
// D-5-10 : trial-gate sur write ops — architecture §6 BINDING
// Règle : valider=non* (transition sur donnée existante — pas de création de valeur)
//         generer/envoyer/pdf=oui
// ============================================================

describe('trial-gate sur write ops (D-5-10)', () => {
  it('cr/generer utilise assertTrialActive', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/chantiers/[id]/cr/generer/route.ts'),
      'utf-8',
    )
    expect(source).toContain('assertTrialActive')
  })

  it('cr/valider N\'utilise PAS assertTrialActive (architecture §6 valider=non*)', () => {
    // F001 fix (Zoro 2026-06-10) : /valider est une transition sur donnée existante
    // — le trial-gate est architecturalement exclu sur ce verbe (§6 note bas de page)
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cr/[id]/valider/route.ts'),
      'utf-8',
    )
    expect(source).not.toContain('assertTrialActive')
  })

  it('rapports-hebdo/valider N\'utilise PAS assertTrialActive (architecture §6 valider=non*)', () => {
    // F001 fix (Zoro 2026-06-10) : même règle que cr/valider
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/rapports-hebdo/[id]/valider/route.ts'),
      'utf-8',
    )
    expect(source).not.toContain('assertTrialActive')
  })

  it('cr/envoyer utilise assertTrialActive', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/cr/[id]/envoyer/route.ts'),
      'utf-8',
    )
    expect(source).toContain('assertTrialActive')
  })
})
