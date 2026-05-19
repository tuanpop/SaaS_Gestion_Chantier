/**
 * tests/e2e/logout.spec.ts — Tests E2E Logout
 *
 * NR-05 : Clic Logout déconnecte (admin) → redirect /login
 * NR-07 : Clic Logout déconnecte (conducteur) → redirect /login
 *
 * Sprint UX-2 — Chantier 2
 *
 * Note : ces tests requièrent un environnement Supabase avec des comptes de test.
 * Ils ne s'exécutent pas en CI vitest — fichiers Playwright (.spec.ts) compilés uniquement.
 */

import { test, expect } from '@playwright/test'

// ============================================================
// NR-05 — Logout Admin
// ============================================================

test.describe('NR-05 — Logout admin', () => {
  test('clic Se déconnecter dans la sidebar → redirect /login', async ({ page }) => {
    // Authentification admin (utilise storageState ou cookies de session)
    // Pré-requis : comptes de test configurés dans playwright.config.ts
    await page.goto('/admin')
    await page.waitForURL('/admin')

    // Le bouton logout est dans la sidebar (LogoutButton variant="sidebar")
    const logoutBtn = page.getByRole('button', { name: /se déconnecter/i })
    await expect(logoutBtn).toBeVisible()

    await logoutBtn.click()

    // Après déconnexion → redirect /login
    await page.waitForURL('/login', { timeout: 5000 })
    expect(page.url()).toContain('/login')
  })
})

// ============================================================
// NR-07 — Logout Conducteur
// ============================================================

test.describe('NR-07 — Logout conducteur', () => {
  test('tap avatar → menu → Se déconnecter → redirect /login', async ({ page }) => {
    // Authentification conducteur
    await page.goto('/conducteur/chantiers')
    await page.waitForURL('/conducteur/chantiers')

    // Avatar menu — bouton "Menu utilisateur"
    const avatarBtn = page.getByRole('button', { name: /menu utilisateur/i })
    await expect(avatarBtn).toBeVisible()

    await avatarBtn.click()

    // Menu déroulant ouvert — bouton "Se déconnecter" (variant menu)
    const logoutBtn = page.getByRole('button', { name: /se déconnecter/i })
    await expect(logoutBtn).toBeVisible()

    await logoutBtn.click()

    // Après déconnexion → redirect /login
    await page.waitForURL('/login', { timeout: 5000 })
    expect(page.url()).toContain('/login')
  })
})
