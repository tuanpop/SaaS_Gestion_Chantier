'use client'

// ============================================================
// Page Login — migré react-hook-form (étape 5, D-2.5-016)
//
// Layout 55/45 :
//   - Gauche 55% : panel marketing (bg-primary-dark, logo, tagline, features, cards)
//   - Droite 45% : tab Connexion/Inscription + formulaires
//
// Tab routing :
//   - ?tab=signup → active l'onglet Inscription au chargement (via useSearchParams)
//   - /register redirige ici avec ?tab=signup (alias décision humaine R-01)
//
// Handlers API inchangés (D-2.5-009 — zéro nouvel endpoint) :
//   - loginForm.handleSubmit → POST /api/auth/login
//   - handleMagicLink → POST /api/auth/magic-link
//   - signupForm.handleSubmit → POST /api/organisations
//
// K2.5-D-06 : Button disabled={isSubmitting}
// RG-MIGR-003 : form aria-busy={isSubmitting}
// I-04 : messages d'erreur génériques côté client
// R-03 : useSearchParams() wrappé dans Suspense
// RG-DS-006 : logo <span class="text-accent">Claw</span>BTP préservé
// ============================================================

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TrendingDown, MessageSquare, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

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
// Schémas Zod — K2.5-T-10 (locaux car login-specific)
// ============================================================

const LoginSchema = z.object({
  email: z.string().email('Adresse email invalide.'),
  password: z.string().min(1, 'Le mot de passe est requis.'),
})

const SignupSchema = z.object({
  nomEntreprise: z.string().min(2).max(100),
  email: z.string().email('Adresse email invalide.'),
  password: z.string().min(12, 'Minimum 12 caractères.'),
})

type LoginInput = z.infer<typeof LoginSchema>
type SignupInput = z.infer<typeof SignupSchema>

// ============================================================
// Composant interne qui lit useSearchParams (Suspense boundary R-03)
// ============================================================

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialTab: TabMode = searchParams.get('tab') === 'signup' ? 'signup' : 'login'
  const [tab, setTab] = useState<TabMode>(initialTab)
  const [signupSecteur, setSignupSecteur] = useState<string>('')

  // Feedback états pour les messages hors react-hook-form
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null)
  const [magicLinkLoading, setMagicLinkLoading] = useState(false)
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null)
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null)

  // ============================================================
  // Form Connexion
  // ============================================================

  const loginForm = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  })

  // ============================================================
  // Form Inscription
  // ============================================================

  const signupForm = useForm<SignupInput>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { nomEntreprise: '', email: '', password: '' },
  })

  // ============================================================
  // Handler — Connexion par mot de passe
  // ============================================================

  async function onLoginSubmit(values: LoginInput) {
    setLoginSuccess(null)
    setMagicLinkError(null)

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: values.email, password: values.password }),
    })

    if (res.ok) {
      router.push('/')
      return
    }

    const data = await res.json() as { error?: string }
    // I-04 : message générique
    const msg = res.status === 429
      ? 'Trop de tentatives. Veuillez réessayer dans quelques minutes.'
      : (data.error ?? 'Un problème est survenu. Vérifiez vos informations.')
    loginForm.setError('root', { type: 'server', message: msg })
  }

  // ============================================================
  // Handler — Magic link
  // ============================================================

  async function handleMagicLink() {
    const email = loginForm.getValues('email')
    if (!email) {
      loginForm.setError('email', { type: 'manual', message: 'Veuillez saisir votre adresse email.' })
      return
    }

    setMagicLinkError(null)
    setLoginSuccess(null)
    setMagicLinkLoading(true)

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (res.status === 429) {
        setMagicLinkError('Trop de tentatives. Veuillez réessayer dans quelques minutes.')
        return
      }

      // I-04 : toujours le même message
      setLoginSuccess("Un lien de connexion a été envoyé si l'adresse est valide.")
    } catch {
      setMagicLinkError('Un problème est survenu. Veuillez réessayer.')
    } finally {
      setMagicLinkLoading(false)
    }
  }

  // ============================================================
  // Handler — Inscription
  // ============================================================

  async function onSignupSubmit(values: SignupInput) {
    setSignupSuccess(null)

    const res = await fetch('/api/organisations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: values.email,
        password: values.password,
        name: values.nomEntreprise,
        secteur: signupSecteur,
      }),
    })

    if (res.status === 429) {
      signupForm.setError('root', {
        type: 'server',
        message: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.',
      })
      return
    }

    if (res.ok) {
      setSignupSuccess('Compte créé avec succès. Vérifiez votre email pour confirmer votre adresse.')
      setTimeout(() => setTab('login'), 3000)
      return
    }

    // I-04 : message générique
    const data = await res.json() as { error?: string }
    signupForm.setError('root', {
      type: 'server',
      message: data.error ?? 'Un problème est survenu. Vérifiez vos informations.',
    })
  }

  const anyLoading = loginForm.formState.isSubmitting || magicLinkLoading || signupForm.formState.isSubmitting

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <div className="min-h-screen flex flex-col md:flex-row">

      {/* ======================================================
          PANEL GAUCHE — 55% — marketing (masqué sur mobile)
          ====================================================== */}
      <div className="hidden md:flex md:w-[55%] bg-[#163958] text-white p-12 flex-col justify-between">

        {/* Logo — RG-DS-006 */}
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

        {/* Cards illustratives */}
        <div className="relative h-48 mt-4">
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

          {/* Tabs Connexion / Inscription — shadcn Tabs (piège 6 : sync état client) */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabMode)} className="mb-8">
            <TabsList className="w-full">
              <TabsTrigger
                value="login"
                className="flex-1"
                data-testid="tab-connexion"
              >
                Connexion
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="flex-1"
                data-testid="tab-inscription"
              >
                Inscription
              </TabsTrigger>
            </TabsList>

            {/* ================================================
                FORM CONNEXION
                ================================================ */}
            <TabsContent value="login" className="pt-6">

              {/* Message succès (magic link) */}
              {loginSuccess && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-4 px-4 py-3 border-2 border-[#1E6B3C] bg-[#E2EFDA] text-[#1E6B3C] text-sm rounded-[6px]"
                >
                  {loginSuccess}
                </div>
              )}

              {/* Erreur root (serveur) */}
              {loginForm.formState.errors.root && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mb-4 px-4 py-3 border-2 border-[#C00000] bg-[#FFCCCC] text-[#C00000] text-sm rounded-[6px]"
                >
                  {loginForm.formState.errors.root.message}
                </div>
              )}

              {/* Erreur magic link */}
              {magicLinkError && (
                <div
                  role="alert"
                  className="mb-4 px-4 py-3 border-2 border-[#C00000] bg-[#FFCCCC] text-[#C00000] text-sm rounded-[6px]"
                >
                  {magicLinkError}
                </div>
              )}

              {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
              <Form {...loginForm}>
                <form
                  onSubmit={loginForm.handleSubmit(onLoginSubmit)}
                  aria-busy={loginForm.formState.isSubmitting}
                  noValidate
                >
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem className="mb-4">
                        <FormLabel>Adresse email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            autoComplete="email"
                            placeholder="vous@entreprise.fr"
                            inputMode="email"
                            disabled={anyLoading}
                            data-testid="login-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="mb-5">
                        <FormLabel>Mot de passe</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="current-password"
                            placeholder="Votre mot de passe"
                            disabled={anyLoading}
                            data-testid="login-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
                  <Button
                    type="submit"
                    disabled={anyLoading}
                    aria-busy={loginForm.formState.isSubmitting}
                    className="w-full text-[16px] py-3"
                    data-testid="login-submit"
                  >
                    {loginForm.formState.isSubmitting ? 'Connexion en cours...' : 'Se connecter'}
                  </Button>
                </form>
              </Form>

              {/* Magic link */}
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => void handleMagicLink()}
                  disabled={anyLoading}
                  aria-busy={magicLinkLoading}
                  data-testid="login-magic-link"
                  className="text-[#1F4E79] text-sm font-semibold underline hover:text-[#F97316] transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#1F4E79] focus:ring-offset-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {magicLinkLoading ? 'Envoi en cours...' : 'Recevoir un lien magique'}
                </button>
              </div>
            </TabsContent>

            {/* ================================================
                FORM INSCRIPTION
                ================================================ */}
            <TabsContent value="signup" className="pt-6">

              {/* Message succès */}
              {signupSuccess && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-4 px-4 py-3 border-2 border-[#1E6B3C] bg-[#E2EFDA] text-[#1E6B3C] text-sm rounded-[6px]"
                >
                  {signupSuccess}
                  <p className="mt-1 text-xs opacity-80">Redirection vers la connexion...</p>
                </div>
              )}

              {/* Erreur root (serveur) */}
              {signupForm.formState.errors.root && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mb-4 px-4 py-3 border-2 border-[#C00000] bg-[#FFCCCC] text-[#C00000] text-sm rounded-[6px]"
                >
                  {signupForm.formState.errors.root.message}
                </div>
              )}

              {!signupSuccess && (
                /* RG-MIGR-003 : form aria-busy={isSubmitting} */
                <Form {...signupForm}>
                  <form
                    onSubmit={signupForm.handleSubmit(onSignupSubmit)}
                    aria-busy={signupForm.formState.isSubmitting}
                    noValidate
                  >
                    <FormField
                      control={signupForm.control}
                      name="nomEntreprise"
                      render={({ field }) => (
                        <FormItem className="mb-4">
                          <FormLabel>Nom de votre entreprise</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="text"
                              autoComplete="organization"
                              placeholder="SARL Dupont Bâtiment"
                              disabled={anyLoading}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Secteur — chips radiogroup (état local hors RHF pour UX des chips) */}
                    <div className="mb-4">
                      <fieldset>
                        <legend className="block text-xs font-heading font-semibold uppercase tracking-wide text-[#555555] mb-2">
                          Secteur d&apos;activité
                        </legend>
                        <div
                          role="radiogroup"
                          aria-label="Secteur d'activité"
                          className="flex flex-wrap gap-2"
                        >
                          {SECTEURS.map((secteur) => (
                            <Button
                              key={secteur}
                              type="button"
                              role="radio"
                              aria-checked={signupSecteur === secteur}
                              onClick={() => setSignupSecteur(secteur)}
                              disabled={anyLoading}
                              variant={signupSecteur === secteur ? 'default' : 'outline'}
                              size="sm"
                            >
                              {secteur}
                            </Button>
                          ))}
                        </div>
                      </fieldset>
                    </div>

                    <FormField
                      control={signupForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem className="mb-4">
                          <FormLabel>Email professionnel</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              autoComplete="email"
                              placeholder="vous@entreprise.fr"
                              inputMode="email"
                              disabled={anyLoading}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={signupForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem className="mb-5">
                          <FormLabel>
                            Mot de passe{' '}
                            <span className="text-muted font-normal normal-case text-xs">(Minimum 12 caractères)</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              autoComplete="new-password"
                              placeholder="Au moins 12 caractères"
                              disabled={anyLoading}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
                    <Button
                      type="submit"
                      disabled={anyLoading}
                      aria-busy={signupForm.formState.isSubmitting}
                      className="w-full text-[16px] py-3"
                      data-testid="signup-submit"
                    >
                      {signupForm.formState.isSubmitting ? 'Création en cours...' : "Démarrer l'essai gratuit"}
                    </Button>

                    <p className="text-center text-[#555] text-sm mt-4">
                      14 jours gratuits, sans carte bancaire
                    </p>
                  </form>
                </Form>
              )}
            </TabsContent>
          </Tabs>
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
