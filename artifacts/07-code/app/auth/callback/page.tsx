'use client'

// ============================================================
// Page d'aboutissement Supabase Auth verify — handler dual implicit + PKCE
//
// CONTEXTE (bug observé prod 2026-05-20)
// auth.admin.generateLink({ type: 'magiclink' }) génère un lien Supabase verify
// qui, à la résolution, redirige vers `redirect_to` en mode IMPLICIT FLOW :
//   /auth/callback#access_token=JWT&refresh_token=XYZ&type=magiclink
//
// Le hash fragment (#...) n'est PAS envoyé au serveur — seul le client le voit.
// Donc /auth/callback doit être un Client Component qui parse window.location.hash.
//
// Variante PKCE (?code=XYZ en query string) gérée aussi en bonus, au cas où
// un autre flow (signInWithPassword recovery, etc.) y atterrit un jour.
//
// SÉCURITÉ : avant setSession, on vérifie que la session courante (si elle
// existe — par exemple un admin déjà connecté dans le browser) est différente
// du user qu'on s'apprête à activer. Sans ce check, un admin connecté qui
// clique le lien d'un conducteur écraserait sa propre session (bug observé
// commit 8111c68 — protection initiale via /auth/invite, mais on l'applique
// aussi ici pour éviter d'écraser la session avant arrivée sur /auth/invite).
// ============================================================

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Status = 'processing' | 'success' | 'error' | 'admin_blocked'

function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [status, setStatus] = useState<Status>('processing')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    async function handleCallback() {
      const next = searchParams.get('next') ?? '/auth/invite'
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/auth/invite'

      // Cas 1 — Hash fragment (implicit flow, mode par défaut de generateLink admin)
      const hash = typeof window !== 'undefined' ? window.location.hash.substring(1) : ''
      const hashParams = new URLSearchParams(hash)
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const hashError = hashParams.get('error_description') || hashParams.get('error')

      // Cas 2 — Query string ?code= (PKCE flow, autres scénarios)
      const code = searchParams.get('code')

      if (hashError) {
        setErrorMsg(hashError)
        setStatus('error')
        return
      }

      if (accessToken && refreshToken) {
        // Implicit flow — protéger contre l'écrasement d'une session admin existante
        const { data: existing } = await supabase.auth.getUser()
        const existingRole = existing?.user?.app_metadata?.['role'] as string | undefined
        if (existing?.user && existingRole === 'admin') {
          setStatus('admin_blocked')
          return
        }

        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          setErrorMsg(error.message)
          setStatus('error')
          return
        }

        // Session créée — nettoyer le hash fragment puis rediriger vers `next`
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', window.location.pathname)
        }
        setStatus('success')
        router.replace(safeNext)
        return
      }

      if (code) {
        // PKCE flow — moins probable avec generateLink admin mais on gère
        const { data: existing } = await supabase.auth.getUser()
        const existingRole = existing?.user?.app_metadata?.['role'] as string | undefined
        if (existing?.user && existingRole === 'admin') {
          setStatus('admin_blocked')
          return
        }

        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setErrorMsg(error.message)
          setStatus('error')
          return
        }
        setStatus('success')
        router.replace(safeNext)
        return
      }

      // Ni hash ni code → lien mal formé
      setErrorMsg('Lien d\'activation incomplet ou invalide.')
      setStatus('error')
    }

    void handleCallback()
  }, [router, searchParams, supabase])

  // ============================================================
  // Rendus selon le status
  // ============================================================

  if (status === 'processing') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4">
        <div className="card-brutal max-w-md w-full p-8 text-center">
          <h1 className="font-heading text-2xl font-bold text-primary-dark mb-3">
            <span className="text-accent">Claw</span>BTP
          </h1>
          <p className="text-muted">Activation de votre compte en cours...</p>
        </div>
      </main>
    )
  }

  if (status === 'admin_blocked') {
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
            Déconnectez-vous depuis votre espace admin, puis ouvrez à nouveau l&apos;email d&apos;invitation (idéalement en fenêtre privée).
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

  if (status === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4 py-12">
        <div className="card-brutal max-w-md w-full p-8">
          <h1 className="font-heading text-2xl font-bold text-primary-dark mb-3">
            <span className="text-accent">Claw</span>BTP
          </h1>
          <h2 className="font-heading text-xl font-semibold text-primary-dark mb-3">
            Lien d&apos;activation invalide
          </h2>
          {errorMsg && (
            <p className="text-sm text-muted mb-3 break-words">
              <span className="font-medium text-primary-dark">Détail&nbsp;:</span> {errorMsg}
            </p>
          )}
          <p className="text-sm text-muted mb-6">
            Demandez à votre administrateur de cliquer sur «&nbsp;Renvoyer&nbsp;» depuis la page Équipe, puis ouvrez l&apos;email le plus récent.
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

  // status === 'success' — router.replace() en cours, écran vide bref
  return null
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex items-center justify-center bg-cream"><p className="text-muted">Chargement...</p></main>}>
      <CallbackInner />
    </Suspense>
  )
}
