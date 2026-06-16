// app/api/chantiers/[id]/derives/route.ts
// GET /api/chantiers/[id]/derives — liste des dérives d'un chantier (admin + conducteur)
//
// Sécurité :
//   TST-K6-12 : IDOR — double défense RLS (D-028) + filtre organisation_id handler-level.
//     404 cross-org (pas 403 — ne révèle pas l'existence de la ressource).
//   TST-K6-13 : conducteur non rattaché → 404 (canAccessChantier).
//   TST-K6-12 : réponse exclut notification_id et organisation_id (surface réduite).
//   Cursor-based pagination (jamais offset — specs §7).
//   runtime = 'nodejs' : service_role requis (adminClient).
//
// Déviation #1 : cast as unknown as sur derives_detectees.
//   TODO: remove cast after supabase gen types post-mig-014.

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessChantier } from '@/lib/chantier-access'
import { DerivesQuerySchema } from '@/lib/validation/detection'
import { logger } from '@/lib/logger'
import type { DeriveDetectee, DerivesChantierResponse } from '@/types/detection'
import type { UserRole } from '@/types/database'

// ============================================================
// GET /api/chantiers/[id]/derives
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'GET /api/chantiers/[id]/derives' })

  try {
    const { id: chantierId } = await params

    // 1. Claims depuis headers middleware
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // Ouvrier : pas d'accès (PO-4V-03)
    if (role === 'ouvrier') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // 2. Vérifier accès au chantier (TST-K6-12/13 — 404 cross-org / conducteur non rattaché)
    const supabase = await createClient()
    const hasAccess = await canAccessChantier(supabase, chantierId, organisationId, userId, role)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // 3. Valider les query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const parsed = DerivesQuerySchema.safeParse(searchParams)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Paramètres de requête invalides.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { cursor, limit, actif } = parsed.data

    // 4. adminClient + filtre handler-level (double défense TST-K6-12)
    const adminClient = createAdminClient()

    // TODO: remove cast after supabase gen types post-mig-014 (déviation #1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as unknown as any)
      .from('derives_detectees')
      // TST-K6-12 : sélection explicite — exclut notification_id et organisation_id (surface réduite)
      .select('id, chantier_id, type, tache_id, signal_valeur, signal_unite, message_llm, detected_at, resolved_at, created_at, updated_at')
      // Filtre handler-level — double défense (RLS + applicatif TST-K6-12)
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId)

    // Filtre actif (défaut = true → resolved_at IS NULL)
    if (actif) {
      query = query.is('resolved_at', null)
    }

    // Pagination cursor-based (jamais offset)
    if (cursor) {
      query = query.lt('detected_at', cursor)
    }

    query = query
      .order('detected_at', { ascending: false })
      .limit(limit)

    const { data, error } = await query as {
      data: Array<{
        id: string
        chantier_id: string
        type: string
        tache_id: string | null
        signal_valeur: number | null
        signal_unite: string | null
        message_llm: string | null
        detected_at: string
        resolved_at: string | null
        created_at: string
        updated_at: string
      }> | null
      error: { message: string } | null
    }

    if (error) {
      reqLogger.error(
        { chantierId, error: error.message },
        'GET /api/chantiers/[id]/derives: erreur DB',
      )
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    const derives = (data ?? []) as unknown as DeriveDetectee[]
    const nextCursor = derives.length === limit
      ? derives[derives.length - 1]!.detected_at
      : null

    const response: DerivesChantierResponse = {
      derives,
      next_cursor: nextCursor,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'GET /api/chantiers/[id]/derives: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
