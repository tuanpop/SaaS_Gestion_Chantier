/**
 * tests/unit/email-layout.test.ts — Tests unitaires Vitest pour lib/notifications/email-layout.ts
 *
 * Scenarios couverts :
 *   1. escapeHtml() — tous les chars dangereux echappes correctement
 *   2. renderEmail() — interpolation correcte via body inline mocke (pas de fs reel)
 *   3. Template manquant — ne throw pas, retourne un string vide dans le body
 *
 * sendEmail() n'est pas teste ici (integration Resend — necessite cle API reelle).
 *
 * fs.readFileSync est mocke via vi.mock('node:fs') pour eviter toute lecture disque.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Mock node:fs — on controle le contenu des templates
// ============================================================

const MOCK_LAYOUT = `<!DOCTYPE html><html><body>
  <h1>{{TITLE}}</h1>
  <div class="preheader">{{PREHEADER}}</div>
  <div class="body">{{BODY}}</div>
</body></html>`

const MOCK_WELCOME_BODY = `<p>Bienvenue {{ORG_NAME}} — <a href="{{APP_URL}}">cliquez ici</a></p>`

vi.mock('node:fs', () => ({
  readFileSync: vi.fn((filePath: string, _encoding: string) => {
    if (String(filePath).endsWith('_layout.html')) return MOCK_LAYOUT
    if (String(filePath).endsWith('welcome.html')) return MOCK_WELCOME_BODY
    // Tout autre fichier simule un template manquant
    throw new Error(`ENOENT: no such file or directory, open '${String(filePath)}'`)
  }),
}))

// ============================================================
// Import APRES le mock (important — Vitest hoist les vi.mock())
// ============================================================

import { escapeHtml, renderEmail } from '../../lib/notifications/email-layout'

// ============================================================
// Tests escapeHtml
// ============================================================

describe('escapeHtml', () => {
  it('echappe les esperluettes', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
  })

  it('echappe les chevrons ouvrants et fermants', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('echappe les guillemets doubles', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('echappe les apostrophes', () => {
    expect(escapeHtml("l'entreprise")).toBe('l&#39;entreprise')
  })

  it('echappe simultanement tous les chars dangereux', () => {
    const input = `<a href="javascript:alert('xss')">clic & moi</a>`
    const output = escapeHtml(input)
    expect(output).not.toContain('<')
    expect(output).not.toContain('>')
    expect(output).not.toContain('"')
    expect(output).not.toContain("'")
    expect(output).toContain('&amp;')
    expect(output).toContain('&lt;')
    expect(output).toContain('&gt;')
    expect(output).toContain('&quot;')
    expect(output).toContain('&#39;')
  })

  it('retourne la chaine inchangee si aucun char special', () => {
    expect(escapeHtml('ClawBTP SAS')).toBe('ClawBTP SAS')
  })

  it('gere une chaine vide sans erreur', () => {
    expect(escapeHtml('')).toBe('')
  })
})

// ============================================================
// Tests renderEmail (interpolation via body inline mocke)
// ============================================================

describe('renderEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injecte TITLE, PREHEADER et BODY dans le layout', () => {
    const html = renderEmail({
      bodyTemplate: 'welcome',
      title: 'Bienvenue sur ClawBTP',
      preheader: 'Votre espace est pret',
      vars: {
        ORG_NAME: 'BTP Martin',
        APP_URL: 'https://saas-gestion-chantier.tanren-studio.com',
      },
    })

    expect(html).toContain('Bienvenue sur ClawBTP')
    expect(html).toContain('Votre espace est pret')
    expect(html).toContain('BTP Martin')
    expect(html).toContain('https://saas-gestion-chantier.tanren-studio.com')
  })

  it('substitue toutes les variables {{KEY}} dans le body fragment', () => {
    const html = renderEmail({
      bodyTemplate: 'welcome',
      title: 'Test',
      preheader: 'Test preheader',
      vars: {
        ORG_NAME: 'Entreprise Test',
        APP_URL: 'https://example.com',
      },
    })

    // Les variables du body doivent etre remplacees, pas les placeholders bruts
    expect(html).not.toContain('{{ORG_NAME}}')
    expect(html).not.toContain('{{APP_URL}}')
    expect(html).toContain('Entreprise Test')
    expect(html).toContain('https://example.com')
  })

  it('echappe le titre et preheader (protection XSS dans layout)', () => {
    const html = renderEmail({
      bodyTemplate: 'welcome',
      title: '<script>XSS</script>',
      preheader: '"danger"',
      vars: { ORG_NAME: 'Test', APP_URL: 'https://example.com' },
    })

    // Le titre est echappe avant injection dans le layout
    expect(html).not.toContain('<script>XSS</script>')
    expect(html).toContain('&lt;script&gt;XSS&lt;/script&gt;')
    expect(html).toContain('&quot;danger&quot;')
  })

  it('ne throw pas si le template de body est introuvable — retourne HTML partiel', () => {
    // 'inexistant' ne matche aucun mock -> readFileSync throw ENOENT
    // loadTemplate() capture et retourne ''
    expect(() => {
      renderEmail({
        bodyTemplate: 'inexistant',
        title: 'Test',
        preheader: 'Test',
        vars: {},
      })
    }).not.toThrow()
  })

  it('retourne une string non vide meme si template body manquant', () => {
    const html = renderEmail({
      bodyTemplate: 'inexistant',
      title: 'Mon titre',
      preheader: 'Mon preheader',
      vars: {},
    })

    // Le layout lui-meme est charge (mock _layout.html) — titre present
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('Mon titre')
  })
})
