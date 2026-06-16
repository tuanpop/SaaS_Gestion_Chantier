// app/api/chantiers/[id]/briefings/route.ts — Liste briefings d'un chantier
// US-060 : liste paginée cursor-based (created_at DESC)
// Auth : JWT admin ou conducteur + ownership chantier
// TST-K7-18 : IDOR cross-org → 404 (pas 403 — ne révèle pas l'existence)
// TST-K7-19 : conducteur non rattaché → 404
// Exclut : donnees_brutes, meteo_snapshot, notification_ids, organisation_id (specs §6.2)
// Limit max 20 enforced server-side (specs §6.2)

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { GetChantierBriefingsQuerySchema } from '@/lib/validation/briefing'
import { canAccessChantier } from '@/lib/chantier-access'
import type { BriefingPublic } from '@/types/briefing'

interface Params {
  params: Promise<{ id: string }>
}

interface BriefingRow {
  id: string
  chantier_id: string
  annee_iso: number
  semaine_iso: number
  contenu_genere: string | null
  message_fallback: string | null
  llm_utilise: boolean
  meteo_disponible: boolean
  code_postal: string | null
  created_at: string
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const chantierId = (await params).id

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // Ouvrier → 403 (TST-K7-19)
    if (userRole !== 'admin' && userRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // ── 2. Ownership chantier + org (TST-K7-18 — 404 cross-org)
    // Double défense : RLS (D-028) + filtre applicatif handler-level
    const hasAccess = await canAccessChantier(
      adminClient,
      chantierId,
      organisationId,
      userId,
      userRole as 'admin' | 'conducteur',
    )

    if (!hasAccess) {
      // 404 (pas 403) — ne révèle pas l'existence (I-06 / TST-K7-18/19)
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // ── 3. Parse query ────────────────────────────────────────────────────────
    const url = new URL(request.url)
    const rawQuery = Object.fromEntries(url.searchParams.entries())
    const parsedQuery = GetChantierBriefingsQuerySchema.safeParse(rawQuery)

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides.', details: parsedQuery.error.flatten() },
        { status: 400 },
      )
    }

    const { limit, cursor } = parsedQuery.data

    // ── 4. Requête briefings — filtre org + chantier OBLIGATOIRES (TST-K7-18) ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as unknown as any)
      .from('briefings')
      .select('id, chantier_id, annee_iso, semaine_iso, contenu_genere, message_fallback, llm_utilise, meteo_disponible, code_postal, created_at')
      // Filtre organisation_id handler-level OBLIGATOIRE (double défense sur adminClient)
      .eq('organisation_id', organisationId)
      .eq('chantier_id', chantierId)
      .order('created_at', { ascending: false })
      .limit(limit + 1) // +1 pour détecter s'il y a une page suivante

    // Pagination cursor (created_at < cursor)
    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    const { data: briefingsRaw, error: briefingsError } = await query as {
      data: BriefingRow[] | null
      error: { message: string } | null
    }

    if (briefingsError) {
      logger.error(
        { chantierId, organisationId, err: briefingsError.message },
        'GET /api/chantiers/[id]/briefings: erreur DB',
      )
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    const rows = briefingsRaw ?? []

    // Pagination cursor
    let nextCursor: string | null = null
    let briefings: BriefingPublic[]

    if (rows.length > limit) {
      // Il y a une page suivante
      const nextPage = rows.slice(0, limit)
      nextCursor = nextPage[nextPage.length - 1]?.created_at ?? null
      briefings = nextPage
    } else {
      briefings = rows
    }

    // Exclure donnees_brutes, meteo_snapshot, notification_ids, organisation_id (specs §6.2)
    // Les champs sélectionnés ne les contiennent pas — déjà filtrés dans le SELECT

    return NextResponse.json(
      { briefings, next_cursor: nextCursor },
      { status: 200 },
    )
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'GET /api/chantiers/[id]/briefings: erreur non gérée',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
