import { redirect } from 'next/navigation'

// Alias pratique : /signup → /register. Beaucoup d'utilisateurs tapent /signup par habitude.
export default function SignupRedirect(): never {
  redirect('/register')
}
