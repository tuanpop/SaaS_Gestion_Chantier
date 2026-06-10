// app/api/cr/[id]/route.ts — Détail CR (GET) + Édition brouillon (PATCH)
// GET US-044 : détail complet incluant contenu_genere et donnees_brutes
// PATCH US-040 : édition contenu_genere si statut=brouillon
// TST-K5-06 : IDOR 404 cross-org
// TST-K5-09 : Zod .strict() — seul contenu_genere accepté dans PATCH

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PatchCrBodySchema } from '@/lib/validation/reporting'
import { assertTrialActive } from '@/lib/trial-gate'
import { logger } from '@/lib/logger'

interface Params {
  params: Promise<{ id: string }>
}

// ============================================================
// GET /api/cr/[id] — Détail complet
// ============================================================

export async function GET(request: Request, { params }: Params) {
  try {
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const crId = (await params).id

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    if (userRole !== 'admin' && userRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // RLS + filtre org handler-level (double défense TST-K5-06)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: crRaw, error } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .select('*')
      .eq('id', crId)
      .eq('organisation_id', organisationId)
      .single()

    if (error || !crRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    return NextResponse.json(crRaw)
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'GET cr/[id]: erreur')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}

// ============================================================
// PATCH /api/cr/[id] — Édition brouillon
// ============================================================

export async function PATCH(request: Request, { params }: Params) {
  try {
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const crId = (await params).id

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    if (userRole !== 'admin' && userRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // Validation Zod .strict() (TST-K5-09 — seul contenu_genere accepté)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }

    const parsed = PatchCrBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Requête invalide.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const adminClient = createAdminClient()

    // Ownership 404 cross-org (TST-K5-06)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: crRaw, error: fetchError } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .select('id, statut, organisation_id')
      .eq('id', crId)
      .eq('organisation_id', organisationId)
      .single()

    if (fetchError || !crRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    const cr = crRaw as unknown as { id: string; statut: string; organisation_id: string }

    // Trial-gate (D-5-10 : PATCH = write)
    await assertTrialActive(adminClient, organisationId)

    // Précondition statut=brouillon (RG-CR-007)
    if (cr.statut !== 'brouillon') {
      return NextResponse.json(
        {
          error: `Ce compte rendu ne peut pas être modifié. Statut actuel : ${cr.statut}.`,
        },
        { status: 409 },
      )
    }

    // UPDATE conditionnel WHERE statut='brouillon' (protection supplémentaire contre race)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedCr, error: updateError } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .update({
        contenu_genere: parsed.data.contenu_genere,
        updated_at: new Date().toISOString(),
      })
      .eq('id', crId)
      .eq('statut', 'brouillon')
      .select('id, contenu_genere, statut, updated_at')
      .single()

    if (updateError || !updatedCr) {
      logger.error({ crId, error: updateError?.message }, 'PATCH cr/[id]: erreur update')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    return NextResponse.json(updatedCr)
  } catch (err) {
    const { toApiResponse } = await import('@/lib/errors')
    return toApiResponse(err)
  }
}
