'use client'

// ============================================================
// Page Login — Sprint 1
//
// Formulaire minimaliste : 2 inputs (email, password) +
//   - Bouton "Connexion" -> POST /api/auth/login
//   - Bouton "Recevoir un lien magique" -> POST /api/auth/magic-link
//
// Sur succès login : router.push('/') (les layouts protégés gèrent la suite — Sprint 2)
// Sur succès magic link : message de confirmation
//
// Accessibilité : labels, aria-describedby sur les erreurs
// Responsive basique : inputs pleine largeur, centré sur mobile
// Pas de shadcn/ui — inputs HTML natifs stylés Tailwind (non installé Sprint 1)
// Validation client : HTML5 required + type=email. Vraie validation = Zod côté serveur.
//
// I-04 : messages d'erreur génériques uniquement (pas d'info sur l'existence du compte)
// ============================================================

import { useState, useId } from 'react'
import { useRouter } from 'next/navigation'

// ============================================================
// Types locaux
// ============================================================

type FormMode = 'password' | 'magic-link'

// ============================================================
// Composant
// ============================================================

export default function LoginPage() {
  const router = useRouter()

  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const successId = useId()

  const [mode, setMode] = useState<FormMode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ============================================================
  // Handlers
  // ============================================================

  async function handleLoginPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        // Sprint 2 : les layouts protégés gèrent la redirection vers le dashboard
        router.push('/')
        return
      }

      // I-04 : message générique, quelle que soit la raison du refus
      const data = await res.json() as { error?: string }
      if (res.status === 429) {
        setErrorMsg('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
      } else {
        // Message du serveur ou fallback générique
        setErrorMsg(data.error ?? 'Un problème est survenu. Vérifiez vos informations.')
      }
    } catch {
      setErrorMsg('Un problème est survenu. Veuillez réessayer.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMagicLink(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault()

    if (!email) {
      setErrorMsg('Veuillez saisir votre adresse email.')
      return
    }

    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (res.status === 429) {
        setErrorMsg('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
        return
      }

      // I-04 : toujours message fictif identique (succès ou non)
      setSuccessMsg("Un lien de connexion a été envoyé si l'adresse est valide.")
    } catch {
      setErrorMsg('Un problème est survenu. Veuillez réessayer.')
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-[var(--color-bg)]">
      <div className="w-full max-w-sm">
        {/* En-tête */}
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[var(--color-text)]">ClawBTP</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Connexion à votre espace</p>
        </header>

        {/* Message d'erreur global */}
        {errorMsg && (
          <div
            id={errorId}
            role="alert"
            className="mb-4 px-4 py-3 rounded-md bg-[var(--color-danger-bg)] border border-[var(--color-danger)] text-[var(--color-danger)] text-sm"
          >
            {errorMsg}
          </div>
        )}

        {/* Message de succès (magic link envoyé) */}
        {successMsg && (
          <div
            id={successId}
            role="status"
            className="mb-4 px-4 py-3 rounded-md bg-[var(--color-success-bg)] border border-[var(--color-success)] text-[var(--color-success)] text-sm"
          >
            {successMsg}
          </div>
        )}

        {/* Formulaire */}
        <form
          onSubmit={handleLoginPassword}
          aria-describedby={errorMsg ? errorId : undefined}
          noValidate
        >
          {/* Email */}
          <div className="mb-4">
            <label
              htmlFor={emailId}
              className="block text-sm font-medium text-[var(--color-text)] mb-1"
            >
              Adresse email
            </label>
            <input
              id={emailId}
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] bg-white placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent disabled:opacity-50 disabled:bg-[var(--color-surface)]"
              placeholder="vous@exemple.fr"
              inputMode="email"
            />
          </div>

          {/* Mot de passe — affiché uniquement en mode password */}
          <div className="mb-6">
            <label
              htmlFor={passwordId}
              className="block text-sm font-medium text-[var(--color-text)] mb-1"
            >
              Mot de passe
            </label>
            <input
              id={passwordId}
              type="password"
              name="password"
              autoComplete="current-password"
              required={mode === 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent disabled:opacity-50 disabled:bg-[var(--color-surface)]"
              placeholder="Votre mot de passe"
            />
          </div>

          {/* Bouton Connexion */}
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full px-4 py-2.5 bg-[var(--color-primary)] text-white text-sm font-semibold rounded-md hover:bg-[var(--color-primary-light)] transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && mode === 'password' ? 'Connexion en cours...' : 'Connexion'}
          </button>

          {/* Séparateur */}
          <div className="my-4 flex items-center gap-2">
            <hr className="flex-1 border-[var(--color-border)]" />
            <span className="text-xs text-[var(--color-text-muted)]">ou</span>
            <hr className="flex-1 border-[var(--color-border)]" />
          </div>

          {/* Bouton Magic Link */}
          <button
            type="button"
            onClick={(e) => {
              setMode('magic-link')
              void handleMagicLink(e)
            }}
            disabled={loading}
            aria-busy={loading && mode === 'magic-link'}
            className="w-full px-4 py-2.5 bg-white text-[var(--color-primary)] text-sm font-semibold rounded-md border border-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && mode === 'magic-link'
              ? 'Envoi en cours...'
              : 'Recevoir un lien magique'}
          </button>
        </form>

        {/* Lien vers l'inscription */}
        <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
          Pas encore de compte ?{' '}
          <a
            href="/register"
            className="font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1 rounded"
          >
            Créer un compte
          </a>
        </p>
      </div>
    </main>
  )
}
