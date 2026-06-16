// app/api/derives/route.ts
// GET /api/derives — vue consolidée des dérives actives (admin uniquement)
//
// Sécurité :
//   TST-K6-14 : IDOR cross-org — filtre organisation_id = JWT OBLIGATOIRE handler-level.
//     adminClient bypasse RLS → ce filtre applicatif est LA SEULE barrière.
//     Si omis : toutes les dérives de toutes les orgs seraient retournées. CRITICAL.
//   TST-K6-15 : élévation — conducteur/ouvrier → 403 (admin only).
//   runtime = 'nodejs' : service_role requis.
//   Cursor-based pagination (jamais offset — specs §7).
//   Retourne total_actives + chantier_nom (JOIN).
//
// Déviation #1 : cast as unknown as sur derives_detectees.
//   TODO: remove cast after supabase gen types post-mig-014.

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DerivesConsolideeQuerySchema } from '@/lib/validation/detection'
import { logger } from '@/lib/logger'
import type { DeriveConsolidee, DerivesConsolideeResponse } from '@/types/detection'
import type { UserRole } from '@/types/database'

// ============================================================
// GET /api/derives
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'GET /api/derives' })

  try {
    // 1. Claims depuis headers middleware
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Admin uniquement (TST-K6-15)
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // 3. Valider les query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const parsed = DerivesConsolideeQuerySchema.safeParse(searchParams)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Paramètres de requête invalides.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { cursor, limit } = parsed.data

    // 4. adminClient — bypass RLS intentionnel (service_role)
    const adminClient = createAdminClient()

    // TST-K6-14 CRITICAL : filtre organisation_id = JWT OBLIGATOIRE
    // adminClient bypasse RLS → sans ce filtre, toutes les orgs seraient exposées.

    // Requête paginée (dérives actives uniquement pour la vue consolidée)
    // TODO: remove cast after supabase gen types post-mig-014 (déviation #1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as unknown as any)
      .from('derives_detectees')
      .select(`
        id, chantier_id, type, tache_id,
        signal_valeur, signal_unite, message_llm,
        detected_at, resolved_at, created_at, updated_at,
        chantiers!inner(nom)
      `)
      // TST-K6-14 BINDING : filtre handler-level organisation_id = JWT
      .eq('organisation_id', organisationId)
      .is('resolved_at', null)

    // Pagination cursor-based
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
        chantiers: { nom: string }
      }> | null
      error: { message: string } | null
    }

    if (error) {
      reqLogger.error({ orgId: organisationId, error: error.message }, 'GET /api/derives: erreur DB')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    const rawData = data ?? []

    // Mapper vers DeriveConsolidee (aplati + chantier_nom)
    const derives: DeriveConsolidee[] = rawData.map((row) => ({
      id: row.id,
      chantier_id: row.chantier_id,
      type: row.type as DeriveConsolidee['type'],
      tache_id: row.tache_id,
      signal_valeur: row.signal_valeur,
      signal_unite: row.signal_unite as DeriveConsolidee['signal_unite'],
      message_llm: row.message_llm,
      detected_at: row.detected_at,
      resolved_at: row.resolved_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      chantier_nom: row.chantiers?.nom ?? '',
    }))

    // Compter les dérives actives totales pour cette org (total_actives)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: totalActives, error: countError } = await (adminClient as unknown as any)
      .from('derives_detectees')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', organisationId)  // TST-K6-14 BINDING
      .is('resolved_at', null) as { count: number | null; error: { message: string } | null }

    if (countError) {
      reqLogger.warn(
        { orgId: organisationId, error: countError.message },
        'GET /api/derives: erreur count total_actives — retourne 0',
      )
    }

    const nextCursor = derives.length === limit
      ? derives[derives.length - 1]!.detected_at
      : null

    const response: DerivesConsolideeResponse = {
      derives,
      total_actives: totalActives ?? 0,
      next_cursor: nextCursor,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'GET /api/derives: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
