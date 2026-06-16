// app/api/briefings/route.ts — Vue consolidée briefings org (admin uniquement)
// US-061 : liste tous les briefings de l'org avec chantier_nom
// Auth : JWT admin UNIQUEMENT → 403 conducteur/ouvrier (TST-K7-21)
// TST-K7-20 : filtre organisation_id JWT OBLIGATOIRE handler-level (seule barrière si adminClient)
// Filtres optionnels toujours combinés au filtre org
// Pagination cursor-based, limit max 20

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { GetBriefingsQuerySchema } from '@/lib/validation/briefing'
import type { BriefingAvecChantier } from '@/types/briefing'

interface BriefingAvecChantierRow {
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
  chantiers: { nom: string } | null
}

export async function GET(request: Request): Promise<Response> {
  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // Admin uniquement → 403 conducteur/ouvrier (TST-K7-21 / specs §6.3)
    if (userRole !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé — admin uniquement.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // ── 2. Parse query ────────────────────────────────────────────────────────
    const url = new URL(request.url)
    const rawQuery = Object.fromEntries(url.searchParams.entries())
    const parsedQuery = GetBriefingsQuerySchema.safeParse(rawQuery)

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides.', details: parsedQuery.error.flatten() },
        { status: 400 },
      )
    }

    const { limit, cursor, chantier_id, semaine_iso, annee_iso } = parsedQuery.data

    // ── 3. Requête briefings ─────────────────────────────────────────────────
    // Filtre organisation_id OBLIGATOIRE handler-level (TST-K7-20 — seule barrière si adminClient)
    // Filtres optionnels TOUJOURS combinés au filtre org

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as unknown as any)
      .from('briefings')
      .select('id, chantier_id, annee_iso, semaine_iso, contenu_genere, message_fallback, llm_utilise, meteo_disponible, code_postal, created_at, chantiers!briefings_chantier_id_fkey(nom)')
      // Filtre org OBLIGATOIRE — jamais omis (TST-K7-20)
      .eq('organisation_id', organisationId)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    // Filtres optionnels — toujours combinés au filtre org
    if (chantier_id !== undefined) {
      query = query.eq('chantier_id', chantier_id)
    }
    if (semaine_iso !== undefined) {
      query = query.eq('semaine_iso', semaine_iso)
    }
    if (annee_iso !== undefined) {
      query = query.eq('annee_iso', annee_iso)
    }

    // Pagination cursor
    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    const { data: briefingsRaw, error: briefingsError } = await query as {
      data: BriefingAvecChantierRow[] | null
      error: { message: string } | null
    }

    if (briefingsError) {
      logger.error(
        { organisationId, err: briefingsError.message },
        'GET /api/briefings: erreur DB',
      )
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    const rows = briefingsRaw ?? []

    // Pagination cursor
    let nextCursor: string | null = null
    let briefingsPage: BriefingAvecChantierRow[]

    if (rows.length > limit) {
      briefingsPage = rows.slice(0, limit)
      nextCursor = briefingsPage[briefingsPage.length - 1]?.created_at ?? null
    } else {
      briefingsPage = rows
    }

    // Mapper vers BriefingAvecChantier (exclut organisation_id, donnees_brutes, meteo_snapshot, notification_ids)
    const briefings: BriefingAvecChantier[] = briefingsPage.map((row): BriefingAvecChantier => ({
      id: row.id,
      chantier_id: row.chantier_id,
      annee_iso: row.annee_iso,
      semaine_iso: row.semaine_iso,
      contenu_genere: row.contenu_genere,
      message_fallback: row.message_fallback,
      llm_utilise: row.llm_utilise,
      meteo_disponible: row.meteo_disponible,
      code_postal: row.code_postal,
      created_at: row.created_at,
      chantier_nom: row.chantiers?.nom ?? 'Chantier inconnu',
    }))

    const total = briefings.length

    return NextResponse.json(
      { total, briefings, next_cursor: nextCursor },
      { status: 200 },
    )
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'GET /api/briefings: erreur non gérée',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
