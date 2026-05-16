import { createServerClient, type CookieOptions } from '@supabase/ssr'
// await cookies() OBLIGATOIRE — Next.js 15 breaking change (D-011)
// Voir : https://nextjs.org/docs/app/api-reference/functions/cookies
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

/**
 * Crée un client Supabase côté serveur (Server Components, Route Handlers, Middleware).
 * Utilise uniquement NEXT_PUBLIC_SUPABASE_ANON_KEY — RLS protège les données.
 * Pour les opérations nécessitant le bypass RLS, utiliser lib/supabase/admin.ts.
 *
 * IMPORTANT : await obligatoire (D-011 — Next.js 15 cookies() est async).
 */
export async function createClient() {
  // await OBLIGATOIRE — Next.js 15 breaking change (D-011)
  const cookieStore = await cookies()

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis.',
    )
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // setAll peut échouer dans les Server Components (read-only).
          // Ignoré intentionnellement — le middleware gère le refresh de session.
        }
      },
    },
  })
}
