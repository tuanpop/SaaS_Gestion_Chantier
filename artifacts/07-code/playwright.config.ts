// playwright.config.ts — Sprint 2.5 (étape 9)
// Ajouts : globalSetup + projets admin/conducteur storageState + workers CI
// D-2.5-025, D-2.5-026

import { defineConfig, devices } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Charger .env.test si présent (CI) sinon .env.local (dev local) — D-2.5-026
const envTestPath = resolve(process.cwd(), '.env.test')
const envLocalPath = resolve(process.cwd(), '.env.local')
const envPathToLoad = existsSync(envTestPath) ? envTestPath : envLocalPath

try {
  const raw = readFileSync(envPathToLoad, 'utf-8')
  let loaded = 0
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value
      loaded++
    }
  }
  if (!process.env['TEST_WORKER_INDEX']) {
    process.stderr.write(`[playwright.config] ${envPathToLoad} chargé (${loaded} variables)\n`)
  }
} catch (err) {
  process.stderr.write(`[playwright.config] échec lecture ${envPathToLoad}: ${err instanceof Error ? err.message : String(err)}\n`)
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // D-2.5-026 : workers CI=1 (mutex DB), local=2
  workers: process.env.CI ? 1 : 2,
  reporter: process.env['CI'] ? 'github' : 'html',

  // D-2.5-026 : globalSetup — reset + seed + login storageState
  // Note: ne sera exécutable qu'après Tanjiro étape 2 (F003 levée — SUPABASE_TEST_URL)
  globalSetup: './tests/e2e/global-setup.ts',

  use: {
    baseURL: process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    // Projet admin — storageState injecté (D-2.5-026)
    {
      name: 'admin',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/admin.json',
      },
      testMatch: /.*admin.*\.spec\.ts/,
    },
    // Projet conducteur — storageState injecté
    {
      name: 'conducteur',
      use: {
        ...devices['Pixel 5'],
        storageState: 'tests/e2e/.auth/conducteur.json',
      },
      testMatch: /.*conducteur.*\.spec\.ts/,
    },
    // Projet chromium générique — tests auth (pas de storageState)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/.*admin.*\.spec\.ts/, /.*conducteur.*\.spec\.ts/],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120 * 1000,
  },
})
