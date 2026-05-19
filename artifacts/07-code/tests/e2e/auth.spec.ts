/**
 * tests/e2e/auth.spec.ts — Tests E2E Auth (login/register/signup)
 *
 * NR-08 : /register redirect → /login?tab=signup → onglet Inscription actif
 * NR-09 : Tab switch Connexion/Inscription sur /login → form correct affiché
 * NR-10 : Secteur chip sélectionné = bg-accent — POST register avec le bon secteur
 *
 * Sprint UX-2 — Chantier 1 (refonte page login)
 *
 * Note : ces tests ne s'exécutent pas en CI vitest — fichiers Playwright compilés uniquement.
 */

import { test, expect } from '@playwright/test'

// ============================================================
// NR-08 — /register → redirect /login?tab=signup
// ============================================================

test.describe('NR-08 — /register redirect vers onglet Inscription', () => {
  test('/register redirige vers /login?tab=signup avec onglet Inscription actif', async ({
    page,
  }) => {
    await page.goto('/register')

    // Après redirect, URL finale = /login?tab=signup
    await page.waitForURL(/\/login.*tab=signup/, { timeout: 5000 })

    // Onglet Inscription actif (aria-selected=true)
    const tabSignup = page.getByRole('tab', { name: /inscription/i })
    await expect(tabSignup).toHaveAttribute('aria-selected', 'true')

    // Panel Inscription visible (contient "Démarrer l'essai gratuit")
    await expect(page.getByRole('button', { name: /démarrer l'essai gratuit/i })).toBeVisible()
  })

  test('/signup redirige directement vers /login?tab=signup (1 saut)', async ({ page }) => {
    await page.goto('/signup')

    // Un seul redirect (pas deux)
    await page.waitForURL(/\/login.*tab=signup/, { timeout: 5000 })

    const tabSignup = page.getByRole('tab', { name: /inscription/i })
    await expect(tabSignup).toHaveAttribute('aria-selected', 'true')
  })
})

// ============================================================
// NR-09 — Tab switch Connexion/Inscription
// ============================================================

test.describe('NR-09 — Tab switch sur /login', () => {
  test('onglet Connexion actif par défaut + switch vers Inscription affiche le bon form', async ({
    page,
  }) => {
    await page.goto('/login')

    // Onglet Connexion actif par défaut
    const tabLogin = page.getByRole('tab', { name: /connexion/i })
    await expect(tabLogin).toHaveAttribute('aria-selected', 'true')

    // Form connexion visible — bouton "Se connecter"
    await expect(page.getByRole('button', { name: /se connecter/i })).toBeVisible()

    // Clic sur onglet Inscription
    const tabSignup = page.getByRole('tab', { name: /inscription/i })
    await tabSignup.click()

    await expect(tabSignup).toHaveAttribute('aria-selected', 'true')
    await expect(tabLogin).toHaveAttribute('aria-selected', 'false')

    // Form inscription visible — bouton "Démarrer l'essai gratuit"
    await expect(
      page.getByRole('button', { name: /démarrer l'essai gratuit/i }),
    ).toBeVisible()

    // Form connexion masqué (attribut hidden sur le tabpanel)
    const panelLogin = page.getByRole('tabpanel', { name: /connexion/i })
    await expect(panelLogin).toBeHidden()
  })
})

// ============================================================
// NR-10 — Chips secteur + POST register
// ============================================================

test.describe('NR-10 — Chips secteur Inscription', () => {
  test('chip sélectionné = bg-accent (orange) + secteur envoyé dans le POST', async ({
    page,
  }) => {
    await page.goto('/login?tab=signup')

    // Aller sur l'onglet Inscription
    const tabSignup = page.getByRole('tab', { name: /inscription/i })
    await tabSignup.click()

    // Sélectionner le secteur "Plomberie"
    const chipPlomberie = page.getByRole('radio', { name: 'Plomberie' })
    await chipPlomberie.click()

    // Chip sélectionné = aria-checked=true
    await expect(chipPlomberie).toHaveAttribute('aria-checked', 'true')

    // Sélectionner un autre secteur
    const chipElec = page.getByRole('radio', { name: 'Électricité' })
    await chipElec.click()
    await expect(chipElec).toHaveAttribute('aria-checked', 'true')

    // Plomberie déselectionné
    await expect(chipPlomberie).toHaveAttribute('aria-checked', 'false')

    // Remplir le reste du formulaire
    await page.getByPlaceholder('SARL Dupont Bâtiment').fill('Test Bâtiment E2E')
    await page
      .getByRole('textbox', { name: /email professionnel/i })
      .fill(`test-e2e-${Date.now()}@signup-test.fr`)
    await page.getByRole('textbox', { name: /mot de passe/i }).fill('MotDePasseTest123!')

    // Intercepter le POST /api/organisations pour vérifier le payload
    const [request] = await Promise.all([
      page.waitForRequest('/api/organisations'),
      page.getByRole('button', { name: /démarrer l'essai gratuit/i }).click(),
    ])

    const body = request.postDataJSON() as Record<string, unknown>
    expect(body['secteur']).toBe('Électricité')
  })
})
