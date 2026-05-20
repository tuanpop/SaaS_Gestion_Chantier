import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRequestLogger } from '@/lib/logger'
import type { Database } from '@/types/database'

// ============================================================
// PATCH /api/auth/complete-invite — Transition invitation_status pending→active
//
// Appelé par /auth/invite/page.tsx immédiatement après supabase.auth.updateUser({ password })
// réussi. Marque le compte de l'invité comme activé dans public.users.
//
// Sécurité :
//   T-01 : user_id lu depuis la session JWT uniquement — jamais depuis body ni params URL.
//          L'ownership est implicite : eq('id', user.id) garantit qu'on ne peut updater
//          que sa propre ligne.
//   Idempotence : le filtre AND invitation_status='pending' assure que si le statut
//          est déjà 'active' (ex: double-clic, retry), le UPDATE affecte 0 lignes
//          sans erreur → réponse 204 dans les deux cas.
//
// D-012 (assertTrialActive) : NON applicable sur cette route.
//   Complete-invite est un flow d'authentification interne (finalisation de compte),
//   pas une mutation business sur les ressources de l'organisation.
//   L'invité n'a pas encore accès à l'app — le bloquer via trial gate serait incohérent
//   et casserait l'onboarding. Justification documentée dans DECISIONLOG.md.
//
// Réponse :
//   204 No Content — succès (ou idempotent : déjà 'active')
//   401 Unauthorized — pas de session JWT valide
//   500 Internal Server Error — erreur DB
// ============================================================

export async function PATCH() {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const correlationId = headerStore.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  try {
    // 1. Auth check — TOUJOURS en premier (T-01)
    //    Lit l'identité depuis la session JWT via les cookies httpOnly.
    //    Ne jamais faire confiance à un user_id venant du body.
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      reqLogger.warn({ correlationId }, 'complete-invite: no valid session')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 2. UPDATE ciblé — ownership enforced applicativement via eq('id', user.id)
    //    eq('id', user.id) garantit qu'on ne peut modifier que sa propre ligne.
    //    user.id provient de la session JWT (étape 1) — T-01 respecté.
    //    Le filtre AND invitation_status='pending' rend la requête idempotente :
    //    si déjà 'active', le UPDATE affecte 0 lignes et retourne sans erreur.
    //
    //    POURQUOI adminClient (pas createClient anon) :
    //    Pattern documenté DECISIONLOG 2026-05-15 Amelia — createServerClient<Database>
    //    avec exactOptionalPropertyTypes:true résout les mutations comme 'never'.
    //    adminClient (createClient de supabase-js) résout correctement les types.
    //    L'ownership est maintenue applicativement (eq('id', user.id) + eq('invitation_status', 'pending')).
    //    DANGER: bypass RLS intentionnel — ownership compensée ci-dessus.
    type UsersUpdate = Database['public']['Tables']['users']['Update']
    const adminClient = createAdminClient()
    const { error: updateError } = await adminClient
      .from('users')
      .update({ invitation_status: 'active' } as UsersUpdate)
      .eq('id', user.id)
      .eq('invitation_status', 'pending')

    if (updateError) {
      reqLogger.error(
        { error: updateError.message, userId: user.id, correlationId },
        'complete-invite: failed to update invitation_status',
      )
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    reqLogger.info(
      { userId: user.id, correlationId },
      'complete-invite: invitation_status updated to active (or was already active)',
    )

    // 3. 204 No Content — succès ou idempotent (déjà 'active')
    return new NextResponse(null, {
      status: 204,
      headers: { 'X-Correlation-Id': correlationId },
    })
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in PATCH /api/auth/complete-invite',
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
