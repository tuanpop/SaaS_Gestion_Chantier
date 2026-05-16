import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Tests d'intégration (RLS Supabase) skippés si SUPABASE_TEST_URL absent
    setupFiles: ['./tests/setup.ts'],
    // E2E Playwright (tests/e2e/) lancés via `npm run test:e2e`, exclus de vitest
    exclude: ['**/node_modules/**', '**/tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: [
        'lib/supabase/client.ts', // client-side only — non testable en node
        '**/*.d.ts',
        '**/*.test.ts',
        '**/node_modules/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    // Variables d'environnement pour les tests
    env: {
      NODE_ENV: 'test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
