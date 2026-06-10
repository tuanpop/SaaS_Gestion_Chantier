// app/api/rapports-hebdo/[id]/route.ts — Détail rapport hebdo (GET) + Édition brouillon (PATCH)
// GET US-046 : détail complet incluant contenu_genere
// PATCH US-046 : édition contenu_genere si statut=brouillon
// TST-K5-06 : IDOR 404 cross-org
// TST-K5-09 : Zod .strict() — seul contenu_genere accepté dans PATCH

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PatchHebdoBodySchema } from '@/lib/validation/reporting'
import { assertTrialActive } from '@/lib/trial-gate'
import { logger } from '@/lib/logger'

interface Params {
  params: Promise<{ id: string }>
}

// ============================================================
// GET /api/rapports-hebdo/[id] — Détail complet
// ============================================================

export async function GET(request: Request, { params }: Params) {
  try {
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const rapportId = (await params).id

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    if (userRole !== 'admin' && userRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Double défense : RLS + filtre org handler-level (TST-K5-06)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rapportRaw, error } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .select('*')
      .eq('id', rapportId)
      .eq('organisation_id', organisationId)
      .single()

    if (error || !rapportRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    return NextResponse.json(rapportRaw)
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'GET rapports-hebdo/[id]: erreur',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}

// ============================================================
// PATCH /api/rapports-hebdo/[id] — Édition brouillon
// ============================================================

export async function PATCH(request: Request, { params }: Params) {
  try {
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const rapportId = (await params).id

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

    const parsed = PatchHebdoBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Requête invalide.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const adminClient = createAdminClient()

    // Ownership 404 cross-org (TST-K5-06)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rapportRaw, error: fetchError } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .select('id, statut, organisation_id')
      .eq('id', rapportId)
      .eq('organisation_id', organisationId)
      .single()

    if (fetchError || !rapportRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    const rapport = rapportRaw as unknown as { id: string; statut: string; organisation_id: string }

    // Trial-gate (D-5-10 : PATCH = write)
    await assertTrialActive(adminClient, organisationId)

    // Précondition statut=brouillon
    if (rapport.statut !== 'brouillon') {
      return NextResponse.json(
        {
          error: `Ce rapport ne peut pas être modifié. Statut actuel : ${rapport.statut}.`,
        },
        { status: 409 },
      )
    }

    // UPDATE conditionnel WHERE statut='brouillon'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedRapport, error: updateError } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .update({
        contenu_genere: parsed.data.contenu_genere,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rapportId)
      .eq('statut', 'brouillon')
      .select('id, contenu_genere, statut, updated_at')
      .single()

    if (updateError || !updatedRapport) {
      logger.error({ rapportId, error: updateError?.message }, 'PATCH rapports-hebdo/[id]: erreur update')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    return NextResponse.json(updatedRapport)
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYMENT_REQUIRED') {
      return NextResponse.json({ error: 'Votre essai gratuit a expiré.' }, { status: 402 })
    }

    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'PATCH rapports-hebdo/[id]: erreur',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
