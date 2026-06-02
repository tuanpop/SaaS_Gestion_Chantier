'use client'

// ============================================================
// Page Set Password — Finalisation invitation conducteur (US-003)
//
// Flow :
//   1. Admin invite conducteur via POST /api/users (Supabase Auth envoie magic link)
//   2. Conducteur clique le lien → Supabase verify → crée session JWT
//      → redirige vers /auth/invite (configuré dans inviteUserByEmail redirectTo)
//   3. Cette page lit la session, demande au user de définir un password
//   4. Submit → supabase.auth.updateUser({ password })
//            → PATCH /api/auth/complete-invite (marque invitation_status='active')
//   5. Redirect vers / (root redirect selon role)
//
// Guards D-040 PRÉSERVÉS — ne pas modifier sans validation humaine explicite.
// Migration étape 5 : form set-password vers react-hook-form + shadcn
// ============================================================

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'

// ============================================================
// Schema Zod local (pas dans lib/validation — form specifique invite)
// K2.5-T-10 : schema pour ce form uniquement, validation login != invite
// ============================================================

const SetPasswordSchema = z
  .object({
    password: z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères.'),
    confirmPassword: z.string().min(12, 'Confirmez votre mot de passe.'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  })

type SetPasswordInput = z.infer<typeof SetPasswordSchema>

// ============================================================
// Composant
// ============================================================

export default function InvitePage() {
  const router = useRouter()
  const supabase = createClient()

  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  // D-040 : guard admin pré-existant
  const [adminBlocked, setAdminBlocked] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(SetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  const { formState: { isSubmitting } } = form

  // ============================================================
  // 1. Vérifier la session — D-040 guards PRÉSERVÉS IMPÉRATIVEMENT
  //    (voir commentaire détaillé dans l'implémentation Sprint 2)
  // ============================================================

  useEffect(() => {
    async function checkSession() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setHasSession(false)
        setCheckingSession(false)
        return
      }
      const role = user.app_metadata?.['role'] as string | undefined

      if (role === 'admin') {
        // D-040 hardening — Discriminer admin pré-existant vs admin nouvellement invité.
        // Les DEUX discriminants doivent être vrais pour autoriser (fail-safe).
        const { data: row } = await supabase
          .from('users')
          .select('invitation_status, created_at')
          .eq('id', user.id)
          .single()

        const typedRow = row as { invitation_status: string | null; created_at: string } | null
        const invitationStatus = typedRow?.invitation_status
        const createdAt = typedRow?.created_at

        const FIVE_MINUTES_MS = 5 * 60 * 1000
        const isRecentlyCreated = createdAt !== undefined && createdAt !== null
          ? (Date.now() - new Date(createdAt).getTime()) < FIVE_MINUTES_MS
          : false

        if (invitationStatus !== 'pending' || !isRecentlyCreated) {
          setAdminBlocked(true)
          setHasSession(false)
          setCheckingSession(false)
          return
        }
      }

      setHasSession(true)
      setEmail(user.email ?? null)
      setCheckingSession(false)
    }
    void checkSession()
  }, [supabase])

  // ============================================================
  // 2. Submit — update password + marquer invite active
  // ============================================================

  async function onSubmit(values: SetPasswordInput) {
    setSubmitError(null)

    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) {
      setSubmitError(error.message)
      return
    }

    // Marquer invitation_status='active' côté serveur
    // Non-bloquant : si l'appel échoue, on continue (best-effort)
    try {
      const res = await fetch('/api/auth/complete-invite', { method: 'PATCH' })
      if (!res.ok) {
        // console.error autorisé ici : Client Component ('use client'), pino/lib/logger.ts
        // ne tourne pas dans le browser. La règle no-console autorise console.error
        // via eslint.config.mjs { allow: ["warn", "error"] }.
        console.error('[complete-invite] PATCH failed', res.status)
        setSubmitError(
          'Compte créé. La mise à jour du statut a échoué — contactez votre administrateur si le badge reste "En attente".',
        )
        // Ne pas return : on continue vers router.push pour ne pas bloquer l'utilisateur
      }
    } catch (fetchErr) {
      console.error('[complete-invite] fetch error', fetchErr)
    }

    router.push('/')
    router.refresh()
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

  if (adminBlocked) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4 py-12">
        <div className="card-brutal max-w-md w-full p-8">
          <h1 className="font-heading text-2xl font-bold text-primary-dark mb-3">
            <span className="text-accent">Claw</span>BTP
          </h1>
          <h2 className="font-heading text-xl font-semibold text-primary-dark mb-3">
            Déconnexion requise
          </h2>
          <p className="text-sm mb-3">
            Vous êtes actuellement connecté en tant qu&apos;administrateur. Pour activer le compte invité, vous devez d&apos;abord vous déconnecter.
          </p>
          <p className="text-sm text-muted mb-6">
            Cliquez sur «&nbsp;Se déconnecter&nbsp;» dans votre espace admin, puis ouvrez à nouveau l&apos;email d&apos;invitation depuis une fenêtre privée (Ctrl+Maj+N) si possible.
          </p>
          <Button asChild className="w-full">
            <Link href="/admin/chantiers">Retour à mon espace admin</Link>
          </Button>
        </div>
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
            Lien d&apos;invitation expiré ou consommé
          </h2>
          <p className="text-sm mb-3">
            Ce lien n&apos;est plus valide. Cela peut arriver si :
          </p>
          <ul className="text-sm text-muted mb-4 ml-4 list-disc">
            <li className="mb-1">Le lien a expiré (24 heures de validité).</li>
            <li className="mb-1">Vous avez déjà cliqué ce lien et défini votre mot de passe (utilisez la page de connexion).</li>
            <li className="mb-1">Votre fournisseur email a généré un aperçu qui a consommé le lien.</li>
            <li>Une invitation plus récente a été envoyée — utilisez le dernier email reçu.</li>
          </ul>
          <p className="text-sm text-muted mb-6">
            Demandez à votre administrateur de cliquer sur <strong className="text-primary-dark">&laquo;&nbsp;Renvoyer&nbsp;&raquo;</strong> depuis la page Équipe.
          </p>
          <Button asChild className="w-full">
            <Link href="/login">Retour à la connexion</Link>
          </Button>
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

        {/* Erreur de soumission non gérée par react-hook-form */}
        {submitError && (
          <div role="alert" className="mb-4 px-4 py-3 bg-danger-bg border-2 border-danger text-danger text-sm rounded-[6px]">
            {submitError}
          </div>
        )}

        {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            aria-busy={isSubmitting}
          >
            <div className="mb-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nouveau mot de passe</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="new-password"
                        placeholder="Au moins 12 caractères"
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>
                      Minimum 12 caractères. Combinez lettres, chiffres et symboles.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="mb-6">
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmation du mot de passe</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="new-password"
                        placeholder="Retapez votre mot de passe"
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
            <Button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? 'Enregistrement...' : 'Finaliser mon compte'}
            </Button>
          </form>
        </Form>
      </div>
    </main>
  )
}
