'use client'

// ============================================================
// Page Register — Sprint 1
//
// Formulaire inscription : 4 inputs (email, password 12+, nom entreprise, secteur)
// POST /api/organisations
// Sur succès : afficher "Compte créé, vérifiez votre email" + redirect /login après 3s
//
// Validation client minimale : HTML5 required + type=email + minLength=12 (password)
// La vraie validation est Zod côté serveur (CreateOrgSchema dans app/api/organisations/route.ts)
//
// I-04 : message d'erreur générique en cas d'email dupliqué
//        (le serveur retourne le même message pour email dupliqué et autres erreurs)
//
// Accessibilité : labels associés, aria-describedby sur les erreurs, aria-live
// Responsive basique : centré, pleine largeur sur mobile
// Pas de shadcn/ui — inputs HTML natifs stylés Tailwind
// ============================================================

import { useState, useId } from 'react'
import { useRouter } from 'next/navigation'

// ============================================================
// Composant
// ============================================================

export default function RegisterPage() {
  const router = useRouter()

  const emailId = useId()
  const passwordId = useId()
  const nameId = useId()
  const secteurId = useId()
  const errorId = useId()
  const successId = useId()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [secteur, setSecteur] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ============================================================
  // Submit
  // ============================================================

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)
    setLoading(true)

    try {
      const res = await fetch('/api/organisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, secteur }),
      })

      if (res.status === 429) {
        setErrorMsg('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
        return
      }

      if (res.ok) {
        // Succès — afficher confirmation et rediriger vers /login après 3 secondes
        setSuccessMsg(
          'Compte créé avec succès. Vérifiez votre email pour confirmer votre adresse.',
        )
        setTimeout(() => {
          router.push('/login')
        }, 3000)
        return
      }

      // I-04 : message générique, que ce soit email dupliqué ou autre erreur serveur
      // Le serveur retourne toujours "Un problème est survenu. Vérifiez vos informations."
      const data = await res.json() as { error?: string }
      setErrorMsg(data.error ?? 'Un problème est survenu. Vérifiez vos informations.')
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
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Créer votre compte — essai gratuit 14 jours
          </p>
        </header>

        {/* Message de succès */}
        {successMsg && (
          <div
            id={successId}
            role="status"
            aria-live="polite"
            className="mb-4 px-4 py-3 rounded-md bg-[var(--color-success-bg)] border border-[var(--color-success)] text-[var(--color-success)] text-sm"
          >
            {successMsg}
            <p className="mt-1 text-xs opacity-80">Redirection vers la page de connexion...</p>
          </div>
        )}

        {/* Message d'erreur */}
        {errorMsg && (
          <div
            id={errorId}
            role="alert"
            aria-live="assertive"
            className="mb-4 px-4 py-3 rounded-md bg-[var(--color-danger-bg)] border border-[var(--color-danger)] text-[var(--color-danger)] text-sm"
          >
            {errorMsg}
          </div>
        )}

        {/* Formulaire — masqué sur succès pour éviter double-soumission */}
        {!successMsg && (
          <form
            onSubmit={handleSubmit}
            aria-describedby={errorMsg ? errorId : undefined}
            noValidate
          >
            {/* Email */}
            <div className="mb-4">
              <label
                htmlFor={emailId}
                className="block text-sm font-medium text-[var(--color-text)] mb-1"
              >
                Adresse email professionnelle
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
                placeholder="vous@entreprise.fr"
                inputMode="email"
              />
            </div>

            {/* Mot de passe */}
            <div className="mb-4">
              <label
                htmlFor={passwordId}
                className="block text-sm font-medium text-[var(--color-text)] mb-1"
              >
                Mot de passe{' '}
                <span className="text-[var(--color-text-muted)] font-normal">
                  (12 caractères minimum)
                </span>
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
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent disabled:opacity-50 disabled:bg-[var(--color-surface)]"
                placeholder="Au moins 12 caractères"
              />
            </div>

            {/* Nom de l'entreprise */}
            <div className="mb-4">
              <label
                htmlFor={nameId}
                className="block text-sm font-medium text-[var(--color-text)] mb-1"
              >
                Nom de votre entreprise
              </label>
              <input
                id={nameId}
                type="text"
                name="name"
                autoComplete="organization"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] bg-white placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent disabled:opacity-50 disabled:bg-[var(--color-surface)]"
                placeholder="SARL Dupont Bâtiment"
                autoCorrect="off"
              />
            </div>

            {/* Secteur d'activité */}
            <div className="mb-6">
              <label
                htmlFor={secteurId}
                className="block text-sm font-medium text-[var(--color-text)] mb-1"
              >
                Secteur d&apos;activité
              </label>
              <input
                id={secteurId}
                type="text"
                name="secteur"
                required
                minLength={2}
                maxLength={100}
                value={secteur}
                onChange={(e) => setSecteur(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] bg-white placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent disabled:opacity-50 disabled:bg-[var(--color-surface)]"
                placeholder="Plomberie, électricité, maçonnerie..."
                autoCorrect="off"
              />
            </div>

            {/* Bouton soumettre */}
            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full px-4 py-2.5 bg-[var(--color-primary)] text-white text-sm font-semibold rounded-md hover:bg-[var(--color-primary-light)] transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Création du compte...' : 'Créer mon compte gratuit'}
            </button>
          </form>
        )}

        {/* Lien vers la connexion */}
        <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
          Déjà un compte ?{' '}
          <a
            href="/login"
            className="font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1 rounded"
          >
            Se connecter
          </a>
        </p>
      </div>
    </main>
  )
}
