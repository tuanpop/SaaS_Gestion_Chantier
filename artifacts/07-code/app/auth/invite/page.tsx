'use client'

// ============================================================
// Page Set Password — Finalisation invitation conducteur (US-003)
//
// Flow :
//   1. Admin invite conducteur via POST /api/users (Supabase Auth envoie magic link)
//   2. Conducteur clique le lien dans l'email → Supabase verify → crée session JWT
//      → redirige vers /auth/invite (configuré dans inviteUserByEmail redirectTo)
//   3. Cette page lit la session, demande au user de définir un password
//   4. Submit → supabase.auth.updateUser({ password }) → marque invitation_status='active'
//   5. Redirect vers / (root redirect selon role)
//
// Si la session n'existe pas (token expiré, lien réutilisé, etc.) :
//   redirect vers /login avec message explicatif.
// ============================================================

import { useState, useEffect, useId } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function InvitePage() {
  const router = useRouter()
  const supabase = createClient()

  const passwordId = useId()
  const confirmId = useId()
  const errorId = useId()

  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 1. Vérifier qu'une session existe (créée par Supabase verify lors du clic email)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setHasSession(true)
        setEmail(user.email ?? null)
      } else {
        setHasSession(false)
      }
      setCheckingSession(false)
    })
  }, [supabase])

  // 2. Submit : update password puis redirect
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorMsg(null)

    if (password.length < 12) {
      setErrorMsg('Le mot de passe doit contenir au moins 12 caractères.')
      return
    }
    if (password !== confirmPassword) {
      setErrorMsg('Les deux mots de passe ne correspondent pas.')
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setErrorMsg(error.message)
        return
      }
      // Succès — root redirect selon role JWT (déjà set par le hook auth)
      router.push('/')
      router.refresh()
    } catch {
      setErrorMsg('Une erreur est survenue. Veuillez réessayer.')
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // États de rendu
  // ============================================================

  if (checkingSession) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4">
        <p className="text-muted">Vérification de l&apos;invitation...</p>
      </main>
    )
  }

  if (!hasSession) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4 py-12">
        <div className="card-brutal max-w-md w-full p-8">
          <h1 className="font-heading text-2xl font-bold text-primary-dark mb-3">
            <span className="text-accent">Claw</span>BTP
          </h1>
          <h2 className="font-heading text-xl font-semibold text-primary-dark mb-3">
            Lien d&apos;invitation invalide
          </h2>
          <p className="text-sm mb-2">
            Ce lien d&apos;invitation a expiré ou a déjà été utilisé.
          </p>
          <p className="text-sm text-muted mb-6">
            Demandez à votre administrateur de renvoyer une invitation.
          </p>
          <Link
            href="/login"
            className="btn-brutal bg-accent text-white w-full inline-block text-center"
          >
            Retour à la connexion
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-cream px-4 py-12">
      <div className="card-brutal max-w-md w-full p-8">
        <header className="mb-6">
          <h1 className="font-heading text-2xl font-bold text-primary-dark mb-1">
            <span className="text-accent">Claw</span>BTP
          </h1>
          <h2 className="font-heading text-xl font-semibold text-primary-dark">
            Définissez votre mot de passe
          </h2>
          {email && (
            <p className="text-sm text-muted mt-2">
              Compte : <strong className="text-primary-dark">{email}</strong>
            </p>
          )}
        </header>

        {errorMsg && (
          <div
            id={errorId}
            role="alert"
            className="mb-4 px-4 py-3 bg-danger-bg border-2 border-danger text-danger text-sm rounded"
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} aria-describedby={errorMsg ? errorId : undefined}>
          <div className="mb-4">
            <label
              htmlFor={passwordId}
              className="block text-sm font-medium text-primary-dark mb-1"
            >
              Nouveau mot de passe
            </label>
            <input
              id={passwordId}
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="input-brutal w-full"
              placeholder="Au moins 12 caractères"
            />
            <p className="text-xs text-muted mt-1">
              Minimum 12 caractères. Combinez lettres, chiffres et symboles.
            </p>
          </div>

          <div className="mb-6">
            <label
              htmlFor={confirmId}
              className="block text-sm font-medium text-primary-dark mb-1"
            >
              Confirmation du mot de passe
            </label>
            <input
              id={confirmId}
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              className="input-brutal w-full"
              placeholder="Retapez votre mot de passe"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="btn-brutal bg-accent text-white w-full"
          >
            {loading ? 'Enregistrement...' : 'Finaliser mon compte'}
          </button>
        </form>
      </div>
    </main>
  )
}
