// tests/e2e/global-setup.ts
// Global setup Playwright — Reset DB + seed + login × 2 + persist storageState
// (D-2.5-026, RG-E2E-003, K2.5-CR-01, K2.5-S-04)
//
// IMPORTANT: Ne peut être exécuté qu'après Tanjiro étape 2 (F003 levée)
// Ce fichier sera exécuté automatiquement via playwright.config.ts globalSetup.
//
// SECURITY: K2.5-CR-01 — Zéro console.log(process.env.*) dans ce fichier
// SECURITY: K2.5-S-04 — storageState écrit dans tests/e2e/.auth/ (gitignored)

import { chromium, type FullConfig } from '@playwright/test'
import { resetAndSeed } from './seed'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Charger .env.test si présent (D-2.5-026)
const envTestPath = path.resolve(process.cwd(), '.env.test')
if (fs.existsSync(envTestPath)) {
  dotenv.config({ path: envTestPath })
}

const AUTH_DIR = path.resolve(process.cwd(), 'tests/e2e/.auth')

async function globalSetup(_config: FullConfig): Promise<void> {
  // Créer le dossier .auth/ si absent (SECURITY: K2.5-S-04)
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true })
  }

  // 1. Reset DB + seed
  let seedResult: Awaited<ReturnType<typeof resetAndSeed>>
  try {
    seedResult = await resetAndSeed()
  } catch (err) {
    // W007 Itachi : message d'erreur explicite si branche Supabase inaccessible
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('SUPABASE_TEST_URL') || message.includes('fetch')) {
      throw new Error(
        'Supabase test branch unreachable. Check SUPABASE_TEST_URL in .env.test.',
      )
    }
    throw err
  }

  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'

  // 2. Login admin + persist storageState
  {
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`${baseUrl}/login`)
    await page.fill('[data-testid="login-email"]', 'admin@e2e.local')
    await page.fill('[data-testid="login-password"]', 'AdminE2E@test123!')
    await page.click('[data-testid="login-submit"]')

    // Attendre la redirection post-login
    await page.waitForURL('**/admin/**', { timeout: 15000 })

    // Probe /api/health — si 401 session expirée, re-login
    const health = await page.request.get(`${baseUrl}/api/health`)
    if (health.status() === 401) {
      await page.goto(`${baseUrl}/login`)
      await page.fill('[data-testid="login-email"]', 'admin@e2e.local')
      await page.fill('[data-testid="login-password"]', 'AdminE2E@test123!')
      await page.click('[data-testid="login-submit"]')
      await page.waitForURL('**/admin/**', { timeout: 15000 })
    }

    // SECURITY: K2.5-S-04 — storageState dans tests/e2e/.auth/ (gitignored)
    await context.storageState({ path: path.join(AUTH_DIR, 'admin.json') })
    await browser.close()
  }

  // 3. Login conducteur + persist storageState
  {
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(`${baseUrl}/login`)
    await page.fill('[data-testid="login-email"]', 'conducteur@e2e.local')
    await page.fill('[data-testid="login-password"]', 'ConducteurE2E@test123!')
    await page.click('[data-testid="login-submit"]')

    // Attendre la redirection post-login conducteur
    await page.waitForURL('**/conducteur/**', { timeout: 15000 })

    // Probe /api/health
    const health = await page.request.get(`${baseUrl}/api/health`)
    if (health.status() === 401) {
      await page.goto(`${baseUrl}/login`)
      await page.fill('[data-testid="login-email"]', 'conducteur@e2e.local')
      await page.fill('[data-testid="login-password"]', 'ConducteurE2E@test123!')
      await page.click('[data-testid="login-submit"]')
      await page.waitForURL('**/conducteur/**', { timeout: 15000 })
    }

    // SECURITY: K2.5-S-04
    await context.storageState({ path: path.join(AUTH_DIR, 'conducteur.json') })
    await browser.close()
  }

  // Stocker les IDs seed pour les tests (via process.env)
  // SECURITY: K2.5-CR-01 — on ne loggue pas les valeurs, on les exporte via env
  process.env.E2E_CHANTIER_ID = seedResult.chantierId
  process.env.E2E_TACHE_ID = seedResult.tacheId
  process.env.E2E_CONDUCTEUR_ID = seedResult.conducteurId
  process.env.E2E_OUVRIER_ID = seedResult.ouvrierUserId
}

export default globalSetup
