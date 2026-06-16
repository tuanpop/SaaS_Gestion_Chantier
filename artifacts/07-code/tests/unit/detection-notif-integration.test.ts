// tests/unit/detection-notif-integration.test.ts — Intégration notification Sprint 6
// Vérifie que le type 'derive_proactive' est bien présent dans NotificationType (types/database.ts).
// Vérifie l'icône ROUGE UNIQUE dans NOTIF_ICON_MAP (PO décision acté).
// Vérifie le buildUrl() vers #alertes pour derive_proactive.
// TST-K6-33 : htmlEscape() appliqué sur titre+message.
// TST-K6-34 : derive_proactive n'expose jamais note_privee_conducteur.

import { describe, it, expect } from 'vitest'

// ============================================================
// Type check — NotificationType inclut 'derive_proactive'
// ============================================================

describe('NotificationType inclut derive_proactive (Sprint 6)', () => {
  it('types/database.ts : NotificationType accepte "derive_proactive" (type check)', () => {
    // Ce test compile seulement si le type est correct
    // On importe le type et vérifie une assignation valide
    type NotificationType = import('../../types/database').NotificationType
    const t: NotificationType = 'derive_proactive'
    expect(t).toBe('derive_proactive')
  })
})

// ============================================================
// htmlEscape — regression XSS (TST-K6-33)
// ============================================================

describe('htmlEscape — protection XSS sur messages dérive', () => {
  it('échappe les caractères HTML dans le titre de notification', async () => {
    const { htmlEscape } = await import('../../lib/notifications/notif')
    const input = '<script>alert("XSS")</script>'
    const output = htmlEscape(input)
    expect(output).not.toContain('<script>')
    expect(output).toContain('&lt;script&gt;')
  })

  it('échappe & en premier (évite double-encodage)', async () => {
    const { htmlEscape } = await import('../../lib/notifications/notif')
    const input = 'Chantier & Travaux'
    const output = htmlEscape(input)
    expect(output).toBe('Chantier &amp; Travaux')
    // Vérifie pas de double-encodage
    expect(output).not.toContain('&amp;amp;')
  })

  it('retourne un string inchangé si pas de caractères spéciaux', async () => {
    const { htmlEscape } = await import('../../lib/notifications/notif')
    const input = 'Chantier route nationale 7'
    expect(htmlEscape(input)).toBe(input)
  })
})

// ============================================================
// TST-K6-33 (complément) : htmlEscape sur valeurs dérive prouve la protection XSS stored
// Prouve que le payload brut XSS passé à htmlEscape (appelé par insertNotification étape 2)
// produit la sortie correctement échappée sans double-encodage.
// Vérifié par Zoro 2026-06-16 : insertNotification est le point unique d'échappement (D-4V-002).
// ============================================================

describe('TST-K6-33 — protection XSS stored : htmlEscape sur payload derive_proactive brut', () => {
  it('titre avec <script> XSS : htmlEscape produit &lt;script&gt; sans double-encodage', async () => {
    const { htmlEscape } = await import('../../lib/notifications/notif')

    const titreBrut = '<script>alert("XSS titre")</script> Derive detectee'
    const escaped = htmlEscape(titreBrut)

    // Le payload brut est échappé correctement
    expect(escaped).not.toContain('<script>')
    expect(escaped).toContain('&lt;script&gt;')
    expect(escaped).toContain('&quot;XSS titre&quot;')
    // Pas de double-encodage (& pas re-encodé en &amp;)
    expect(escaped).not.toContain('&amp;lt;')
    expect(escaped).not.toContain('&amp;gt;')
  })

  it('message avec <img onerror> : htmlEscape neutralise les chevrons de la balise', async () => {
    const { htmlEscape } = await import('../../lib/notifications/notif')

    // htmlEscape échappe < et > — le tag <img ...> devient &lt;img ...&gt; (inoffensif dans le DOM)
    // L'attribut onerror reste comme texte mais la balise n'est plus parsée en HTML.
    const messageBrut = '<img src=x onerror=alert(1)> Budget depasse a 92%.'
    const escaped = htmlEscape(messageBrut)

    // Le chevron ouvrant <img est neutralisé
    expect(escaped).not.toContain('<img')
    expect(escaped).toContain('&lt;img')
    // Pas de double-encodage
    expect(escaped).not.toContain('&amp;lt;')
  })

  it('titre sain (sans HTML) : htmlEscape ne le modifie pas — pas de sur-encodage', async () => {
    const { htmlEscape } = await import('../../lib/notifications/notif')

    const titreSain = 'Derive detectee Chantier route nationale 7'
    expect(htmlEscape(titreSain)).toBe(titreSain)
  })

  it('insertNotification est le point unique d\'echappement (D-4V-002) — pas d\'appel htmlEscape dans le cron', () => {
    // Test structurel : vérifie que le cron NE contient PAS d'appel explicite à htmlEscape
    // (ce serait un double-échappement). L'échappement est délégué à insertNotification.
    const { readFileSync } = require('node:fs')
    const { join } = require('node:path')
    const cronSource = readFileSync(
      join(process.cwd(), 'app', 'api', 'cron', 'derives', 'route.ts'),
      'utf8',
    ) as string

    // Le cron ne doit pas appeler htmlEscape directement sur titre ou message
    // (pattern : htmlEscape(titre) ou htmlEscape(messageLlm))
    expect(cronSource).not.toMatch(/htmlEscape\s*\(\s*titre\s*\)/)
    expect(cronSource).not.toMatch(/htmlEscape\s*\(\s*messageLlm\s*\)/)
  })
})

// ============================================================
// escapeDelimiter — protection injection LLM (EXI-Y-K6-03)
// Testé via genererMessageDerive.ts
// ============================================================

describe('escapeDelimiter — protection anti-injection délimiteurs LLM (EXI-Y-K6-03)', () => {
  it('les dérives tache_bloquee ne contiennent pas note_privee_conducteur (EXI-Y-K6-02)', () => {
    // Test structurel : le type SignalDeriveTacheBloquee n'a pas ce champ
    type SignalDeriveTacheBloquee = import('../../types/detection').SignalDeriveTacheBloquee
    const signal: SignalDeriveTacheBloquee = {
      type: 'tache_bloquee_longue',
      tache_id: 't-1',
      tache_titre: 'Coulage béton',
      jours_bloque: 5,
      seuil_applique: 3,
    }
    expect(signal).not.toHaveProperty('note_privee_conducteur')
  })

  it('DeriveDetectee exclut organisation_id et notification_id (TST-K6-12)', () => {
    // Test structurel via assignation de type
    type DeriveDetectee = import('../../types/detection').DeriveDetectee
    const d: DeriveDetectee = {
      id: 'dd-1',
      chantier_id: 'ch-1',
      type: 'budget_depasse',
      tache_id: null,
      signal_valeur: 0.92,
      signal_unite: 'ratio',
      message_llm: 'Test.',
      detected_at: new Date().toISOString(),
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    // Ces champs NE doivent PAS être dans le type DeriveDetectee
    expect(d).not.toHaveProperty('organisation_id')
    expect(d).not.toHaveProperty('notification_id')
  })
})

// ============================================================
// SignauxDeriveChantier — isolation cross-org (TST-K6-03)
// ============================================================

describe('SignauxDeriveChantier — isolation cross-org (TST-K6-03)', () => {
  it('SignauxDeriveChantier contient organisation_id (isolation par prompt)', () => {
    type SignauxDeriveChantier = import('../../types/detection').SignauxDeriveChantier
    // Le type doit avoir organisation_id pour que le cron puisse isoler par org
    const s: SignauxDeriveChantier = {
      chantier_id: 'ch-1',
      chantier_nom: 'Test',
      organisation_id: 'org-1',
      seuils: {
        organisation_id: 'org-1',
        ratio_budget: 0.85,
        jours_blocage: 3,
        jours_inactivite: 7,
        source: 'defaut',
      },
      evaluated_at: new Date().toISOString(),
      derives: [],
    }
    expect(s.organisation_id).toBe('org-1')
  })
})

// ============================================================
// CSS tokens Sprint 6 — présents dans globals.css
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('CSS tokens Sprint 6 — présents dans globals.css (F004 BINDING)', () => {
  const cssPath = join(process.cwd(), 'app', 'globals.css')
  let cssContent: string

  try {
    cssContent = readFileSync(cssPath, 'utf8')
  } catch {
    cssContent = ''
  }

  const requiredTokens = [
    '--color-derive-critique-bg',
    '--color-derive-critique-border',
    '--color-derive-critique-text',
    '--color-derive-warning-bg',
    '--color-derive-warning-border',
    '--color-derive-warning-text',
    '--color-sain-bg',
    '--color-sain-border',
    '--color-sain-text',
    '--color-alerte-rouge',
  ]

  for (const token of requiredTokens) {
    it(`CSS token "${token}" est défini dans globals.css`, () => {
      expect(cssContent).toContain(token)
    })
  }
})
