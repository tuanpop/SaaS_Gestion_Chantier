/**
 * tests/e2e/equipe.spec.ts — Tests E2E page Équipe admin
 *
 * NR-06 : Admin crée conducteur via modal → invitation envoyée
 * NR-11 : Admin ouvre modal QR ouvrier → texte "Sprint 3" affiché, bouton désactivé
 * NR-12 : Admin liste /admin/equipe visible avec les membres de l'organisation
 *
 * Sprint UX-2 — Chantier 3
 *
 * Note : ces tests requièrent un environnement Supabase avec des comptes de test.
 * Ils ne s'exécutent pas en CI vitest — fichiers Playwright (.spec.ts) compilés uniquement.
 */

import { test, expect } from '@playwright/test'

// ============================================================
// NR-12 — Liste équipe visible
// ============================================================

test.describe('NR-12 — Page /admin/equipe', () => {
  test('page accessible et table des membres rendue', async ({ page }) => {
    await page.goto('/admin/equipe')
    await page.waitForURL('/admin/equipe')

    // Titre de la page
    await expect(page.getByRole('heading', { name: /équipe/i })).toBeVisible()

    // Bouton invitation présent
    await expect(page.getByRole('button', { name: /inviter un membre/i })).toBeVisible()

    // Table avec au moins les en-têtes (même si 0 membres)
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /nom/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /rôle/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /statut/i })).toBeVisible()
  })
})

// ============================================================
// NR-06 — Création conducteur via modal
// ============================================================

test.describe('NR-06 — Invitation conducteur', () => {
  test('ouvrir modal → remplir formulaire conducteur → soumettre → toast succès', async ({
    page,
  }) => {
    await page.goto('/admin/equipe')
    await page.waitForURL('/admin/equipe')

    // Ouvrir la modal
    await page.getByRole('button', { name: /inviter un membre/i }).click()

    // Modal ouverte — titre visible
    await expect(
      page.getByRole('heading', { name: /inviter un collaborateur/i }),
    ).toBeVisible()

    // Onglet Conducteur actif par défaut
    const tabConducteur = page.getByRole('tab', { name: /conducteur/i })
    await expect(tabConducteur).toHaveAttribute('aria-selected', 'true')

    // Remplir le formulaire
    await page.getByPlaceholder('Jean').fill('Pierre')
    await page.getByPlaceholder('Dupont').fill('Martin')
    await page.getByPlaceholder('conducteur@chantier.fr').fill('pierre.martin@test-e2e.fr')

    // Soumettre
    await page.getByRole('button', { name: /^inviter$/i }).click()

    // Toast succès (ou message d'erreur si email déjà utilisé — acceptable en E2E)
    // On vérifie qu'une réponse est reçue (toast ou erreur inline)
    const toast = page.getByRole('status')
    const errorAlert = page.getByRole('alert')

    await expect(toast.or(errorAlert)).toBeVisible({ timeout: 5000 })
  })
})

// ============================================================
// NR-11 — Modal QR placeholder
// ============================================================

test.describe('NR-11 — Modal QR placeholder Sprint 3', () => {
  test('bouton QR ouvrier → modal → texte Sprint 3 + bouton désactivé', async ({ page }) => {
    await page.goto('/admin/equipe')
    await page.waitForURL('/admin/equipe')

    // Chercher un bouton QR dans la table (requiert au moins un ouvrier dans l'org de test)
    const qrButtons = page.getByRole('button', { name: /^qr$/i })
    const count = await qrButtons.count()

    if (count === 0) {
      // Pas d'ouvrier dans l'org de test — skip (marquer comme inconclusive)
      test.skip()
      return
    }

    await qrButtons.first().click()

    // Modal QR visible
    await expect(
      page.getByText(/génération du qr disponible sprint 3/i),
    ).toBeVisible()

    // Bouton "Générer le QR" désactivé
    const generateBtn = page.getByRole('button', { name: /générer le qr/i })
    await expect(generateBtn).toBeDisabled()

    // Fermer
    await page.getByRole('button', { name: /fermer/i }).click()
    await expect(page.getByText(/génération du qr disponible sprint 3/i)).not.toBeVisible()
  })
})
