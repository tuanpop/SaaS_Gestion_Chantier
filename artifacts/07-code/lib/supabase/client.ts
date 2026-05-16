'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/**
 * Crée un client Supabase côté navigateur (Client Components uniquement).
 * Utilise uniquement NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * JAMAIS de SERVICE_ROLE_KEY côté client (I-02).
 *
 * Usage :
 *   const supabase = createClient()
 *   const { data: { user } } = await supabase.auth.getUser()
 */
export function createClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis.',
    )
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}
