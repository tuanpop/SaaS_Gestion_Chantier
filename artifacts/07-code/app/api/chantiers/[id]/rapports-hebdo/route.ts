// app/api/chantiers/[id]/rapports-hebdo/route.ts — Liste paginée rapports hebdo
// US-045 : liste avec pagination cursor sur (annee_iso DESC, semaine_iso DESC)
// TST-K5-07 : ownership 404 cross-org
// Max limit=50 enforced server-side
// Exclut contenu_genere (liste compacte — specs §6.3)

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { z } from 'zod'

interface Params {
  params: Promise<{ id: string }>
}

const QuerySchema = z.object({
  cursor_annee: z.coerce.number().int().min(2020).max(2100).optional(),
  cursor_semaine: z.coerce.number().int().min(1).max(53).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  statut: z.enum(['brouillon', 'valide', 'envoye']).optional(),
})

export async function GET(request: Request, { params }: Params) {
  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
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

    const adminClient = createAdminClient()

    // ── 2. Ownership chantier (TST-K5-07) ────────────────────────────────────
    const { data: chantierRaw, error: chantierError } = await adminClient
      .from('chantiers')
      .select('id')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (chantierError || !chantierRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // ── 3. Parse query ────────────────────────────────────────────────────────
    const url = new URL(request.url)
    const rawQuery = Object.fromEntries(url.searchParams.entries())
    const parsedQuery = QuerySchema.safeParse(rawQuery)

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Requête invalide.', details: parsedQuery.error.flatten() },
        { status: 400 },
      )
    }

    const { cursor_annee, cursor_semaine, limit, statut } = parsedQuery.data

    // ── 4. Requête DB — cursor sur (annee_iso DESC, semaine_iso DESC) ─────────
    // Exclut contenu_genere (liste compacte)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as unknown as any)
      .from('rapports_hebdo')
      .select(
        'id, chantier_id, organisation_id, annee_iso, semaine_iso, cr_ids, statut, valide_par, valide_at, envoye_at, created_at, updated_at',
      )
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId)
      .order('annee_iso', { ascending: false })
      .order('semaine_iso', { ascending: false })
      .limit(limit + 1) // +1 pour détecter page suivante

    // Cursor pagination composite (annee, semaine) DESC
    if (cursor_annee !== undefined && cursor_semaine !== undefined) {
      // Simuler: WHERE (annee_iso, semaine_iso) < (cursor_annee, cursor_semaine)
      // En SQL : WHERE annee_iso < cursor_annee OR (annee_iso = cursor_annee AND semaine_iso < cursor_semaine)
      // Supabase JS ne supporte pas le tuple comparison directement → filtre OR
      query = query.or(
        `annee_iso.lt.${cursor_annee},and(annee_iso.eq.${cursor_annee},semaine_iso.lt.${cursor_semaine})`,
      ) as typeof query
    }

    if (statut) {
      query = query.eq('statut', statut) as typeof query
    }

    const { data: rapportsRaw, error: rapportsError } = await query

    if (rapportsError) {
      logger.error({ chantierId, error: rapportsError.message }, 'GET rapports-hebdo liste: erreur DB')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    const rapports = rapportsRaw ?? []
    const hasNextPage = rapports.length > limit
    const items = hasNextPage ? rapports.slice(0, limit) : rapports

    let nextCursorAnnee: number | null = null
    let nextCursorSemaine: number | null = null

    if (hasNextPage && items.length > 0) {
      const last = items[items.length - 1] as unknown as {
        annee_iso: number
        semaine_iso: number
      }
      nextCursorAnnee = last.annee_iso
      nextCursorSemaine = last.semaine_iso
    }

    return NextResponse.json({
      rapports_hebdo: items,
      next_cursor:
        nextCursorAnnee !== null
          ? { annee: nextCursorAnnee, semaine: nextCursorSemaine }
          : null,
    })
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'GET rapports-hebdo liste: erreur')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
