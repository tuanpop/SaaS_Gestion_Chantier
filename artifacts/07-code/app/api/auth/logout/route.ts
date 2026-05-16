import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { toApiResponse } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'

// ============================================================
// POST /api/auth/logout — Invalidation de session
// Route protégée par le middleware JWT (retourne 401 si non authentifié)
// signOut() invalide la session côté Supabase ET supprime les cookies de session
// ============================================================

export async function POST() {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const correlationId = headerStore.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  try {
    // await createClient() OBLIGATOIRE — Next.js 15 (D-011)
    const supabase = await createClient()

    // Vérifier qu'une session active existe avant de déconnecter
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      // Le middleware aurait dû bloquer avant, mais défense en profondeur
      reqLogger.warn({ correlationId }, 'Logout called with no active session')
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // Invalider la session Supabase (supprime les cookies de session côté serveur)
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      reqLogger.error(
        { error: signOutError.message, userId: user.id, correlationId },
        'Failed to sign out',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    reqLogger.info({ userId: user.id, correlationId }, 'User logged out successfully')

    return NextResponse.json(
      { data: { message: 'Déconnexion réussie.' } },
      { status: 200, headers: { 'X-Correlation-Id': correlationId } },
    )
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in POST /api/auth/logout',
    )
    return toApiResponse(error, correlationId)
  }
}
