// Vitest global setup
// Les tests d'intégration marqués @integration sont skippés si SUPABASE_TEST_URL est absent.
// Les tests unitaires tournent toujours.

import { beforeAll } from 'vitest'

beforeAll(() => {
  // Vérification environnement test
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error('Tests must run with NODE_ENV=test')
  }
})
