'use client'

// ============================================================
// Page Login — Sprint UX-2 (refonte complète depuis proto 14-admin-login.html)
//
// Layout 55/45 :
//   - Gauche 55% : panel marketing (bg-primary-dark, logo, tagline, features, cards)
//   - Droite 45% : tab Connexion/Inscription + formulaires
//
// Tab routing :
//   - ?tab=signup → active l'onglet Inscription au chargement (via useSearchParams)
//   - /register redirige ici avec ?tab=signup (alias décision humaine R-01)
//
// Handlers API inchangés vs Sprint 1 :
//   - handleLoginPassword → POST /api/auth/login
//   - handleMagicLink → POST /api/auth/magic-link
//   - handleRegister → POST /api/organisations
//
// Accessibilité :
//   - useId() sur tous les inputs/labels
//   - role="alert" sur erreurs, role="status" sur succès
//   - aria-live, aria-describedby, aria-busy
//   - inputMode="email", autoComplete appropriés
//   - minLength={12} sur password inscription
//   - noValidate (validation Zod serveur)
//
// R-03 : useSearchParams() wrappé dans Suspense (boundary gérée en parent ou inline)
// I-04 : messages d'erreur génériques côté client
// ============================================================

import { useState, useId, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TrendingDown, MessageSquare, ShieldCheck } from 'lucide-react'

// ============================================================
// Types locaux
// ============================================================

type TabMode = 'login' | 'signup'

// ============================================================
// Secteurs d'activité — 8 chips (proto 14-admin-login.html)
// ============================================================

const SECTEURS = [
  'Plomberie',
  'Électricité',
  'Carrelage',
  'Peinture',
  'Maçonnerie',
  'Charpente',
  'Menuiserie',
  'Multi-corps',
] as const

// ============================================================
// Composant interne qui lit useSearchParams (Suspense boundary obligatoire)
// ============================================================

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Lire le tab initial depuis les query params (?tab=signup)
  const initialTab: TabMode = searchParams.get('tab') === 'signup' ? 'signup' : 'login'
  const [tab, setTab] = useState<TabMode>(initialTab)

  // ============================================================
  // IDs accessibilité
  // ============================================================

  const loginEmailId = useId()
  const loginPasswordId = useId()
  const loginErrorId = useId()
  const loginSuccessId = useId()
  const signupNomEntrepriseId = useId()
  const signupEmailId = useId()
  const signupPasswordId = useId()
  const signupErrorId = useId()
  const signupSuccessId = useId()

  // ============================================================
  // État formulaire Connexion
  // ============================================================

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null)
  const [magicLinkLoading, setMagicLinkLoading] = useState(false)

  // ============================================================
  // État formulaire Inscription
  // ============================================================

  const [signupNomEntreprise, setSignupNomEntreprise] = useState('')
  const [signupSecteur, setSignupSecteur] = useState<string>('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupLoading, setSignupLoading] = useState(false)
  const [signupError, setSignupError] = useState<string | null>(null)
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null)

  // ============================================================
  // Handlers — Connexion par mot de passe
  // ============================================================

  async function handleLoginPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoginError(null)
    setLoginSuccess(null)
    setLoginLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })

      if (res.ok) {
        router.push('/')
        return
      }

      const data = await res.json() as { error?: string }
      if (res.status === 429) {
        setLoginError('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
      } else {
        // I-04 : message générique
        setLoginError(data.error ?? 'Un problème est survenu. Vérifiez vos informations.')
      }
    } catch {
      setLoginError('Un problème est survenu. Veuillez réessayer.')
    } finally {
      setLoginLoading(false)
    }
  }

  // ============================================================
  // Handler — Magic link
  // ============================================================

  async function handleMagicLink(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault()

    if (!loginEmail) {
      setLoginError('Veuillez saisir votre adresse email.')
      return
    }

    setLoginError(null)
    setLoginSuccess(null)
    setMagicLinkLoading(true)

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail }),
      })

      if (res.status === 429) {
        setLoginError('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
        return
      }

      // I-04 : toujours le même message (succès ou non)
      setLoginSuccess("Un lien de connexion a été envoyé si l'adresse est valide.")
    } catch {
      setLoginError('Un problème est survenu. Veuillez réessayer.')
    } finally {
      setMagicLinkLoading(false)
    }
  }

  // ============================================================
  // Handler — Inscription
  // ============================================================

  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSignupError(null)
    setSignupSuccess(null)
    setSignupLoading(true)

    try {
      const res = await fetch('/api/organisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signupEmail,
          password: signupPassword,
          name: signupNomEntreprise,
          secteur: signupSecteur,
        }),
      })

      if (res.status === 429) {
        setSignupError('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
        return
      }

      if (res.ok) {
        setSignupSuccess('Compte créé avec succès. Vérifiez votre email pour confirmer votre adresse.')
        setTimeout(() => {
          setTab('login')
        }, 3000)
        return
      }

      // I-04 : message générique
      const data = await res.json() as { error?: string }
      setSignupError(data.error ?? 'Un problème est survenu. Vérifiez vos informations.')
    } catch {
      setSignupError('Un problème est survenu. Veuillez réessayer.')
    } finally {
      setSignupLoading(false)
    }
  }

  const anyLoading = loginLoading || magicLinkLoading || signupLoading

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <div className="min-h-screen flex flex-col md:flex-row">

      {/* ======================================================
          PANEL GAUCHE — 55% — marketing (masqué sur mobile)
          ====================================================== */}
      <div className="hidden md:flex md:w-[55%] bg-[#163958] text-white p-12 flex-col justify-between">

        {/* Logo */}
        <div>
          <h1 className="font-heading font-[800] text-[36px] mb-8">
            <span className="text-[#F97316]">Claw</span>BTP
          </h1>

          {/* Tagline */}
          <h2 className="font-heading font-semibold text-[26px] leading-tight mb-3 max-w-md">
            Tes équipes parlent sur le chantier.{' '}
            Le SaaS en tire ton planning, ton CR et tes alertes.
          </h2>
          <p className="text-[15px] text-white/70 italic mb-10">
            Le chat de chantier qui pilote vraiment.
          </p>

          {/* Features */}
          <ul className="space-y-4 mb-12">
            <li className="flex items-start gap-3">
              <TrendingDown className="w-5 h-5 text-[#F97316] shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-[15px] text-white/90">
                Marges et dérives visibles en direct sur tous tes chantiers
              </span>
            </li>
            <li className="flex items-start gap-3">
              <MessageSquare className="w-5 h-5 text-[#F97316] shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-[15px] text-white/90">
                Le chat de tes équipes devient ton CR et ton planning
              </span>
            </li>
            <li className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[#F97316] shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-[15px] text-white/90">
                {"L'IA propose, ton conducteur décide — jamais d'automatisation aveugle"}
              </span>
            </li>
          </ul>
        </div>

        {/* Cards illustratives empilées */}
        <div className="relative h-48 mt-4">
          {/* Card Martin */}
          <div
            className="absolute top-0 left-0 card-brutal p-4 w-64 bg-white"
            style={{ transform: 'rotate(-4deg)', opacity: 0.8 }}
            aria-hidden="true"
          >
            <div className="flex justify-between items-center mb-2">
              <span className="font-heading font-bold text-[#222] text-sm">Chantier Martin</span>
              <span className="badge badge-success text-xs">OK</span>
            </div>
            <p className="text-xs text-[#555] mb-2">Budget : 42 000 €</p>
            <div className="progress-bar">
              <div className="progress-fill bg-[#1E6B3C]" style={{ width: '55%' }} />
            </div>
          </div>

          {/* Card Dupont */}
          <div
            className="absolute top-4 left-16 card-brutal p-4 w-64 bg-white"
            style={{ transform: 'rotate(2deg)', opacity: 0.9 }}
            aria-hidden="true"
          >
            <div className="flex justify-between items-center mb-2">
              <span className="font-heading font-bold text-[#222] text-sm">Chantier Dupont</span>
              <span className="badge badge-danger text-xs">Dérive</span>
            </div>
            <p className="text-xs text-[#555] mb-2">Budget : 78 500 €</p>
            <div className="progress-bar">
              <div className="progress-fill bg-[#C00000]" style={{ width: '78%' }} />
            </div>
          </div>

          {/* Card Leclerc */}
          <div
            className="absolute top-8 left-32 card-brutal p-4 w-64 bg-white"
            style={{ transform: 'rotate(-1deg)' }}
            aria-hidden="true"
          >
            <div className="flex justify-between items-center mb-2">
              <span className="font-heading font-bold text-[#222] text-sm">Chantier Leclerc</span>
              <span className="badge badge-warning text-xs">Retard</span>
            </div>
            <p className="text-xs text-[#555] mb-2">Budget : 31 200 €</p>
            <div className="progress-bar">
              <div className="progress-fill bg-[#833C00]" style={{ width: '92%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================
          PANEL DROIT — 45% — formulaires
          ====================================================== */}
      <div className="flex-1 md:w-[45%] bg-[#FAFAF8] flex items-center justify-center p-8 md:p-12">
        <div className="w-full max-w-md">

          {/* Logo mobile uniquement */}
          <div className="md:hidden mb-8 text-center">
            <h1 className="font-heading font-[800] text-[28px]">
              <span className="text-[#F97316]">Claw</span>BTP
            </h1>
          </div>

          {/* ================================================
              Tab Connexion / Inscription
              ================================================ */}
          <div
            role="tablist"
            aria-label="Mode d'accès"
            className="flex mb-8"
          >
            <button
              role="tab"
              aria-selected={tab === 'login'}
              aria-controls="panel-login"
              id="tab-login"
              type="button"
              onClick={() => setTab('login')}
              className={`tab-brutal flex-1 rounded-l-md border-r-0 ${
                tab === 'login' ? 'active' : ''
              }`}
            >
              Connexion
            </button>
            <button
              role="tab"
              aria-selected={tab === 'signup'}
              aria-controls="panel-signup"
              id="tab-signup"
              type="button"
              onClick={() => setTab('signup')}
              className={`tab-brutal flex-1 rounded-r-md ${
                tab === 'signup' ? 'active' : ''
              }`}
            >
              Inscription
            </button>
          </div>

          {/* ================================================
              FORM CONNEXION
              ================================================ */}
          <div
            role="tabpanel"
            id="panel-login"
            aria-labelledby="tab-login"
            hidden={tab !== 'login'}
          >
            {/* Message erreur */}
            {loginError && (
              <div
                id={loginErrorId}
                role="alert"
                aria-live="assertive"
                className="mb-4 px-4 py-3 border-2 border-[#C00000] bg-[#FFCCCC] text-[#C00000] text-sm rounded-md"
              >
                {loginError}
              </div>
            )}

            {/* Message succès (magic link) */}
            {loginSuccess && (
              <div
                id={loginSuccessId}
                role="status"
                aria-live="polite"
                className="mb-4 px-4 py-3 border-2 border-[#1E6B3C] bg-[#E2EFDA] text-[#1E6B3C] text-sm rounded-md"
              >
                {loginSuccess}
              </div>
            )}

            <form
              onSubmit={(e) => void handleLoginPassword(e)}
              aria-describedby={loginError ? loginErrorId : undefined}
              noValidate
            >
              {/* Email */}
              <div className="mb-4">
                <label
                  htmlFor={loginEmailId}
                  className="block text-sm font-semibold text-[#222] mb-1.5"
                >
                  Adresse email
                </label>
                <input
                  id={loginEmailId}
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  disabled={anyLoading}
                  className="input-brutal"
                  placeholder="vous@entreprise.fr"
                  inputMode="email"
                />
              </div>

              {/* Mot de passe */}
              <div className="mb-5">
                <label
                  htmlFor={loginPasswordId}
                  className="block text-sm font-semibold text-[#222] mb-1.5"
                >
                  Mot de passe
                </label>
                <input
                  id={loginPasswordId}
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  disabled={anyLoading}
                  className="input-brutal"
                  placeholder="Votre mot de passe"
                />
              </div>

              {/* CTA Connexion */}
              <button
                type="submit"
                disabled={anyLoading}
                aria-busy={loginLoading}
                className="btn-brutal bg-[#F97316] text-white w-full py-3 text-[16px] justify-center"
              >
                {loginLoading ? 'Connexion en cours...' : 'Se connecter'}
              </button>
            </form>

            {/* Magic link */}
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={(e) => void handleMagicLink(e)}
                disabled={anyLoading}
                aria-busy={magicLinkLoading}
                className="text-[#1F4E79] text-sm font-semibold underline hover:text-[#F97316] transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#1F4E79] focus:ring-offset-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {magicLinkLoading ? 'Envoi en cours...' : 'Recevoir un lien magique'}
              </button>
            </div>
          </div>

          {/* ================================================
              FORM INSCRIPTION
              ================================================ */}
          <div
            role="tabpanel"
            id="panel-signup"
            aria-labelledby="tab-signup"
            hidden={tab !== 'signup'}
          >
            {/* Message succès */}
            {signupSuccess && (
              <div
                id={signupSuccessId}
                role="status"
                aria-live="polite"
                className="mb-4 px-4 py-3 border-2 border-[#1E6B3C] bg-[#E2EFDA] text-[#1E6B3C] text-sm rounded-md"
              >
                {signupSuccess}
                <p className="mt-1 text-xs opacity-80">Redirection vers la connexion...</p>
              </div>
            )}

            {/* Message erreur */}
            {signupError && (
              <div
                id={signupErrorId}
                role="alert"
                aria-live="assertive"
                className="mb-4 px-4 py-3 border-2 border-[#C00000] bg-[#FFCCCC] text-[#C00000] text-sm rounded-md"
              >
                {signupError}
              </div>
            )}

            {!signupSuccess && (
              <form
                onSubmit={(e) => void handleRegister(e)}
                aria-describedby={signupError ? signupErrorId : undefined}
                noValidate
              >
                {/* Nom entreprise */}
                <div className="mb-4">
                  <label
                    htmlFor={signupNomEntrepriseId}
                    className="block text-sm font-semibold text-[#222] mb-1.5"
                  >
                    Nom de votre entreprise
                  </label>
                  <input
                    id={signupNomEntrepriseId}
                    type="text"
                    name="name"
                    autoComplete="organization"
                    required
                    minLength={2}
                    maxLength={100}
                    value={signupNomEntreprise}
                    onChange={(e) => setSignupNomEntreprise(e.target.value)}
                    disabled={anyLoading}
                    className="input-brutal"
                    placeholder="SARL Dupont Bâtiment"
                    autoCorrect="off"
                  />
                </div>

                {/* Secteur — chips radiogroup */}
                <div className="mb-4">
                  <fieldset>
                    <legend className="block text-sm font-semibold text-[#222] mb-2">
                      Secteur d&apos;activité
                    </legend>
                    <div
                      role="radiogroup"
                      aria-label="Secteur d'activité"
                      className="flex flex-wrap gap-2"
                    >
                      {SECTEURS.map((secteur) => (
                        <button
                          key={secteur}
                          type="button"
                          role="radio"
                          aria-checked={signupSecteur === secteur}
                          onClick={() => setSignupSecteur(secteur)}
                          disabled={anyLoading}
                          className={`btn-brutal text-sm px-3 py-2 ${
                            signupSecteur === secteur
                              ? 'bg-[#F97316] text-white'
                              : 'bg-white text-[#1F4E79]'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {secteur}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>

                {/* Email professionnel */}
                <div className="mb-4">
                  <label
                    htmlFor={signupEmailId}
                    className="block text-sm font-semibold text-[#222] mb-1.5"
                  >
                    Email professionnel
                  </label>
                  <input
                    id={signupEmailId}
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    disabled={anyLoading}
                    className="input-brutal"
                    placeholder="vous@entreprise.fr"
                    inputMode="email"
                  />
                </div>

                {/* Mot de passe */}
                <div className="mb-5">
                  <label
                    htmlFor={signupPasswordId}
                    className="block text-sm font-semibold text-[#222] mb-1.5"
                  >
                    Mot de passe
                    <span className="text-[#555] font-normal text-xs ml-1">
                      (Minimum 12 caractères)
                    </span>
                  </label>
                  <input
                    id={signupPasswordId}
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    disabled={anyLoading}
                    className="input-brutal"
                    placeholder="Au moins 12 caractères"
                  />
                </div>

                {/* CTA Inscription */}
                <button
                  type="submit"
                  disabled={anyLoading}
                  aria-busy={signupLoading}
                  className="btn-brutal bg-[#F97316] text-white w-full py-3 text-[16px] justify-center"
                >
                  {signupLoading ? 'Création en cours...' : 'Démarrer l\'essai gratuit'}
                </button>

                <p className="text-center text-[#555] text-sm mt-4">
                  14 jours gratuits, sans carte bancaire
                </p>
              </form>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ============================================================
// Export page — wrapper Suspense pour useSearchParams (R-03)
// Next.js 15 : useSearchParams() dans Client Component requiert Suspense boundary
// ============================================================

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
        <div className="text-[#555] text-sm">Chargement...</div>
      </div>
    }>
      <LoginPageInner />
    </Suspense>
  )
}
