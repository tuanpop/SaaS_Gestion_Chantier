import { redirect } from 'next/navigation'

// ============================================================
// /signup — Alias direct vers /login?tab=signup (Sprint UX-2, R-01)
//
// Avant Sprint UX-2 : /signup → /register → /login?tab=signup (2 sauts)
// Après Sprint UX-2 : /signup → /login?tab=signup (1 saut direct)
//
// /signup n'est pas une route Supabase Auth — pas besoin de redirect conditionnel.
// Les magic links Supabase pointent vers /register (géré séparément) ou /login.
// ============================================================

export default function SignupRedirect(): never {
  redirect('/login?tab=signup')
}
