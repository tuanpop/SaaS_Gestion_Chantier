// ============================================================
// /register — Redirect conditionnel (Sprint UX-2, R-01)
//
// Décision humaine 2026-05-19 (R-01) :
//   - Si des query params Supabase sont présents (token_hash, type, error_description,
//     error, access_token, refresh_token) → redirect vers /login en conservant
//     les query params originaux (magic links, email confirmations, etc.)
//   - Sinon → redirect vers /login?tab=signup (onglet Inscription présélectionné)
//
// Raison : les magic links Supabase envoient leurs tokens en query params.
// Si on redirige vers /login?tab=signup, on écraserait les params Supabase
// et le callback d'auth échouerait silencieusement.
//
// Ce composant est un Server Component — les searchParams sont lus côté serveur.
// ============================================================

import { redirect } from 'next/navigation'

// Params Supabase connus qui indiquent un callback d'auth en cours
const SUPABASE_AUTH_PARAMS = [
  'token_hash',
  'type',
  'error_description',
  'error',
  'error_code',
  'access_token',
  'refresh_token',
  'code',
] as const

interface RegisterPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = await searchParams

  // Détecter si un paramètre Supabase Auth est présent
  const hasSupabaseAuthParam = SUPABASE_AUTH_PARAMS.some(
    (key) => params[key] !== undefined
  )

  if (hasSupabaseAuthParam) {
    // Conserver les query params originaux → /login?token_hash=...&type=...
    const queryString = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const value = Array.isArray(v) ? v[0] : v
        return `${encodeURIComponent(k)}=${encodeURIComponent(value ?? '')}`
      })
      .join('&')

    redirect(`/login${queryString ? `?${queryString}` : ''}`)
  }

  // Pas de params Supabase → redirection vers l'onglet Inscription
  redirect('/login?tab=signup')
}
