// app/api/rapports-hebdo/[id]/valider/route.ts — Valider un rapport hebdo (brouillon → valide)
// US-046 : transition brouillon → valide
// RG-RH-005 : idempotent si déjà valide
// TST-K5-06 : IDOR 404 cross-org
// Note : trial-gate ABSENT sur /valider (architecture §6 : valider=non* — transition sur donnée existante)

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: Params) {
  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
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

    // ── 2. Ownership 404 (TST-K5-06) ────────────────────────────────────────
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

    // ── 3. Idempotence — déjà valide → 200 ──────────────────────────────────
    if (rapport.statut === 'valide') {
      return NextResponse.json({ id: rapport.id, statut: rapport.statut })
    }

    // ── 4. Déjà envoyé → 409 ────────────────────────────────────────────────
    if (rapport.statut === 'envoye') {
      return NextResponse.json(
        { error: 'Ce rapport a déjà été envoyé et ne peut pas être revalidé.' },
        { status: 409 },
      )
    }

    // ── 5. UPDATE brouillon → valide ─────────────────────────────────────────
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedRapport, error: updateError } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .update({
        statut: 'valide',
        valide_par: userId,
        valide_at: now,
        updated_at: now,
      })
      .eq('id', rapportId)
      .eq('statut', 'brouillon')
      .select('id, statut, valide_par, valide_at, updated_at')
      .single()

    if (updateError || !updatedRapport) {
      logger.warn({ rapportId, userId }, 'POST rapports-hebdo/valider: statut changé concurrentiellement')
      return NextResponse.json(
        { error: 'Ce rapport ne peut plus être validé.' },
        { status: 409 },
      )
    }

    logger.info({ rapportId, userId }, 'POST rapports-hebdo/valider: rapport validé')

    return NextResponse.json(updatedRapport)
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'POST rapports-hebdo/valider: erreur',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
