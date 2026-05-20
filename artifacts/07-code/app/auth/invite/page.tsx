'use client'

// ============================================================
// Page Set Password — Finalisation invitation conducteur (US-003)
//
// Flow :
//   1. Admin invite conducteur via POST /api/users (Supabase Auth envoie magic link)
//   2. Conducteur clique le lien dans l'email → Supabase verify → crée session JWT
//      → redirige vers /auth/invite (configuré dans inviteUserByEmail redirectTo)
//   3. Cette page lit la session, demande au user de définir un password
//   4. Submit → supabase.auth.updateUser({ password })
//            → PATCH /api/auth/complete-invite (marque invitation_status='active')
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
  const [adminBlocked, setAdminBlocked] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 1. Vérifier qu'une session existe (créée par /auth/callback via exchangeCodeForSession)
  //    + Défense en profondeur : refuser le set-password si la session courante
  //    est un admin DÉJÀ ACTIF (cas observé prod 2026-05-20 : si /auth/callback
  //    rate l'échange ET qu'un admin existant est connecté dans le même navigateur,
  //    getUser retourne l'admin → on aurait modifié le password de l'admin).
  //
  //    Sprint 2 dette (2026-05-20 soir) : la version précédente bloquait TOUT
  //    role=admin, y compris le NOUVEL admin invité dont la session vient d'être
  //    set par /auth/callback. On distingue maintenant via invitation_status :
  //      - 'pending' : nouvel admin invité, set-password autorisé
  //      - 'active' / null : admin pré-existant, bloqué
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
        //
        // Deux discriminants indépendants — condition && = fail-safe :
        //   1. invitation_status === 'pending' (statut DB)
        //   2. created_at récent (< 5 min) — signal fort qu'on vient de créer ce compte
        //
        // Les DEUX doivent être vrais pour laisser passer.
        // Si l'UN OU L'AUTRE échoue → bloquer (fail-safe par défaut).
        //
        // Justification created_at vs alternatives :
        //   - email_confirmed_at / last_sign_in_at (auth.users) : inaccessibles depuis
        //     le client Supabase anon sans appel API supplémentaire.
        //   - created_at (public.users) : accessible via RLS (user peut lire son row).
        //     Un nouvel invité vient d'être créé → created_at < 5 min est un signal fort.
        //     Un admin pré-existant a forcément un created_at de plusieurs heures/jours.
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
          // Admin pré-existant OU compte créé il y a > 5 min (fail-safe).
          // Bloquer pour éviter d'écraser le password d'un admin déjà actif.
          setAdminBlocked(true)
          setHasSession(false)
          setCheckingSession(false)
          return
        }
        // Sinon : nouvel admin invité (invitation_status='pending' ET créé < 5 min),
        // set-password autorisé (fall through).
      }

      setHasSession(true)
      setEmail(user.email ?? null)
      setCheckingSession(false)
    }
    void checkSession()
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

      // Marquer invitation_status='active' côté serveur via l'endpoint dédié.
      // T-01 : l'endpoint lit le user_id depuis la session JWT — jamais depuis body.
      // Non-bloquant : si l'appel échoue, on continue quand même vers le redirect
      // (la transition de statut est best-effort ; l'admin peut voir "En attente"
      // dans la liste mais le compte est fonctionnel). L'erreur est loggée côté
      // client via console.error — EXCEPTION à la règle no-console : ce composant
      // est un Client Component ('use client'), lib/logger.ts (pino) ne tourne pas
      // dans le browser. Le console.error est l'unique fallback autorisé dans ce cas.
      try {
        const res = await fetch('/api/auth/complete-invite', { method: 'PATCH' })
        if (!res.ok) {
          // console.error autorisé ici : Client Component ('use client'), pino/lib/logger.ts
          // ne tourne pas dans le browser. La règle no-console autorise console.error
          // via eslint.config.mjs { allow: ["warn", "error"] }. Ce cas est l'unique
          // exception au no-console côté client — annoté explicitement par le plan.
          console.error('[complete-invite] PATCH failed', res.status)
          // Toast non-bloquant — le redirect se fera quand même
          setErrorMsg(
            'Compte créé. La mise à jour du statut a échoué — contactez votre administrateur si le badge reste "En attente".'
          )
          // Ne pas return : on continue vers router.push pour ne pas bloquer l'utilisateur
        }
      } catch (fetchErr) {
        // Réseau coupé ou autre erreur inattendue — ne pas bloquer le flow
        console.error('[complete-invite] fetch error', fetchErr)
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
          <Link
            href="/admin/chantiers"
            className="btn-brutal bg-accent text-white w-full inline-block text-center"
          >
            Retour à mon espace admin
          </Link>
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
            <li className="mb-1">Votre fournisseur email (Gmail, Outlook) a généré un aperçu qui a consommé le lien — c&apos;est un problème connu.</li>
            <li>Une invitation plus récente a été envoyée — utilisez le dernier email reçu.</li>
          </ul>
          <p className="text-sm text-muted mb-6">
            Demandez à votre administrateur de cliquer sur <strong className="text-primary-dark">&laquo;&nbsp;Renvoyer&nbsp;&raquo;</strong> depuis la page Équipe, puis ouvrez l&apos;email le plus récent.
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
