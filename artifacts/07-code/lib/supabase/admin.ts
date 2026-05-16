// DANGER: bypass RLS total — utiliser uniquement pour [signup public, auth-hook]
// Ce fichier ne doit JAMAIS être importé dans des fichiers 'use client'.
// La SERVICE_ROLE_KEY ne doit JAMAIS être préfixée NEXT_PUBLIC_.
// Cas d'usage autorisés :
//   1. POST /api/organisations — création d'organisation lors du signup public
//   2. supabase/functions/auth-hook.ts — injection claims JWT organisation_id + role

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logger } from '@/lib/logger'

/**
 * Crée un client Supabase avec la service role key (bypass RLS total).
 * Côté SERVEUR UNIQUEMENT — jamais importé dans 'use client'.
 *
 * Vérifie les variables d'environnement au moment de l'appel.
 * Si les variables sont absentes, throw en fail-fast pour éviter des erreurs silencieuses.
 */
export function createAdminClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!supabaseUrl) {
    logger.error('NEXT_PUBLIC_SUPABASE_URL manquante — createAdminClient() ne peut pas démarrer')
    throw new Error('NEXT_PUBLIC_SUPABASE_URL est requis pour le client admin Supabase.')
  }

  if (!serviceRoleKey) {
    logger.error('SUPABASE_SERVICE_ROLE_KEY manquante — createAdminClient() ne peut pas démarrer')
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY est requis pour le client admin Supabase. ' +
      'Cette variable ne doit jamais être préfixée NEXT_PUBLIC_.',
    )
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
