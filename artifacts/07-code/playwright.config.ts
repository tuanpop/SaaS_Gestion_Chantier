import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Playwright tourne dans un process séparé de Next.js — charger .env.local manuellement.
// Parse minimal sans dépendance dotenv. Format: KEY=VALUE par ligne.
const envPath = resolve(process.cwd(), '.env.local')
try {
  const raw = readFileSync(envPath, 'utf-8')
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
  // Log uniquement sur le process principal (pas chaque worker), via stderr pour ne pas polluer stdout
  if (!process.env['TEST_WORKER_INDEX']) {
    process.stderr.write(`[playwright.config] .env.local chargé (${loaded} variables) depuis ${envPath}\n`)
  }
} catch (err) {
  process.stderr.write(`[playwright.config] échec lecture ${envPath}: ${err instanceof Error ? err.message : String(err)}\n`)
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // séquentiel pour éviter les conflits DB en test
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: process.env['CI'] ? 'github' : 'html',

  use: {
    baseURL: process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile ouvrier (PWA)
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Démarrer le serveur Next.js avant les tests si pas déjà démarré
  webServer: {
    command: 'npm run dev',
    url: process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120 * 1000,
  },
})
