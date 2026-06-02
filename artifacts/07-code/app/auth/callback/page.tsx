'use client'

// ============================================================
// Page d'aboutissement Supabase Auth verify — migré Card shadcn (étape 8, E-02)
//
// Guards D-035 PRÉSERVÉS — ne pas modifier sans validation humaine
// Logique callback inchangée (D-2.5-005)
// ============================================================

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

      const hash = typeof window !== 'undefined' ? window.location.hash.substring(1) : ''
      const hashParams = new URLSearchParams(hash)
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const hashError = hashParams.get('error_description') || hashParams.get('error')

      const code = searchParams.get('code')

      if (hashError) {
        setErrorMsg(hashError)
        setStatus('error')
        return
      }

      if (accessToken && refreshToken) {
        // D-035 : protéger contre l'écrasement d'une session admin existante
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

        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', window.location.pathname)
        }
        setStatus('success')
        router.replace(safeNext)
        return
      }

      if (code) {
        // D-035 : même garde
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

      setErrorMsg("Lien d'activation incomplet ou invalide.")
      setStatus('error')
    }

    void handleCallback()
  }, [router, searchParams, supabase])

  // ============================================================
  // Rendus selon le status — Card shadcn
  // ============================================================

  if (status === 'processing') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4">
        <Card className="max-w-md w-full p-8 text-center">
          {/* RG-DS-006 : logo préservé */}
          <h1 className="font-heading text-2xl font-bold text-primary-dark mb-3">
            <span className="text-accent">Claw</span>BTP
          </h1>
          <p className="text-muted">Activation de votre compte en cours...</p>
        </Card>
      </main>
    )
  }

  if (status === 'admin_blocked') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4 py-12">
        <Card className="max-w-md w-full">
          <CardHeader>
            <h1 className="font-heading text-2xl font-bold text-primary-dark">
              <span className="text-accent">Claw</span>BTP
            </h1>
            <CardTitle>Déconnexion requise</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Vous êtes actuellement connecté en tant qu&apos;administrateur. Pour activer le compte invité, vous devez d&apos;abord vous déconnecter.
            </p>
            <p className="text-sm text-muted">
              Déconnectez-vous depuis votre espace admin, puis ouvrez à nouveau l&apos;email d&apos;invitation (idéalement en fenêtre privée).
            </p>
            <Button asChild className="w-full">
              <Link href="/admin/chantiers">Retour à mon espace admin</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (status === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-cream px-4 py-12">
        <Card className="max-w-md w-full">
          <CardHeader>
            <h1 className="font-heading text-2xl font-bold text-primary-dark">
              <span className="text-accent">Claw</span>BTP
            </h1>
            <CardTitle>Lien d&apos;activation invalide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {errorMsg && (
              <p className="text-sm text-muted break-words">
                <span className="font-medium text-primary-dark">Détail&nbsp;:</span> {errorMsg}
              </p>
            )}
            <p className="text-sm text-muted">
              Demandez à votre administrateur de cliquer sur «&nbsp;Renvoyer&nbsp;» depuis la page Équipe.
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Retour à la connexion</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return null
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-cream">
        <p className="text-muted">Chargement...</p>
      </main>
    }>
      <CallbackInner />
    </Suspense>
  )
}
