// app/api/chantiers/[id]/cr/route.ts — Liste paginée des CRs d'un chantier
// US-044 : liste CRs avec pagination cursor date_cr DESC
// TST-K5-07 : ownership 404 cross-org
// Max limit=50 enforced server-side (specs §6.3)
// Exclut contenu_genere et donnees_brutes (liste compacte)

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GetCrListQuerySchema } from '@/lib/validation/reporting'
import { logger } from '@/lib/logger'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: Params) {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const chantierId = (await params).id

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    if (userRole !== 'admin' && userRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // ── 2. Ownership chantier (TST-K5-07) ────────────────────────────────────
    const adminClient = createAdminClient()

    const { data: chantierRaw, error: chantierError } = await adminClient
      .from('chantiers')
      .select('id')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (chantierError || !chantierRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // ── 3. Parse query params ─────────────────────────────────────────────────
    const url = new URL(request.url)
    const rawQuery = Object.fromEntries(url.searchParams.entries())
    const parsedQuery = GetCrListQuerySchema.safeParse(rawQuery)

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Requête invalide.', details: parsedQuery.error.flatten() },
        { status: 400 },
      )
    }

    const { cursor, limit, statut } = parsedQuery.data

    // ── 4. Requête DB ─────────────────────────────────────────────────────────
    // Exclut contenu_genere et donnees_brutes (specs §6.3 — liste compacte)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as unknown as any)
      .from('comptes_rendus')
      .select(
        'id, chantier_id, organisation_id, date_cr, statut, declenche_par, valide_par, valide_at, envoye_at, created_at, updated_at',
      )
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId)
      .order('date_cr', { ascending: false })
      .limit(limit + 1) // +1 pour déterminer s'il y a une page suivante

    // Cursor pagination sur date_cr DESC
    if (cursor) {
      query = query.lt('date_cr', cursor) as typeof query
    }

    // Filtre statut optionnel
    if (statut) {
      query = query.eq('statut', statut) as typeof query
    }

    const { data: crsRaw, error: crsError } = await query

    if (crsError) {
      logger.error({ chantierId, error: crsError.message }, 'GET cr liste: erreur DB')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    const crs = crsRaw ?? []

    // Déterminer le next_cursor
    const hasNextPage = crs.length > limit
    const items = hasNextPage ? crs.slice(0, limit) : crs
    const nextCursor = hasNextPage ? (items[items.length - 1] as unknown as { date_cr: string }).date_cr : null

    return NextResponse.json({
      comptes_rendus: items,
      next_cursor: nextCursor,
    })
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'GET cr liste: erreur')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
