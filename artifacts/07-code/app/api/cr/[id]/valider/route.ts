// app/api/cr/[id]/valider/route.ts — Valider un CR (brouillon → valide)
// US-041 : transition brouillon → valide
// RG-CR-010 : idempotent si déjà valide
// TST-K5-06 : IDOR 404 cross-org
// TST-K5-03 : statut envoye → 409 (pas de rétrogradation)
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
    // ── 1. Auth — claims headers middleware ──────────────────────────────────
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

    // ── 2. Ownership 404 cross-org (TST-K5-06) ───────────────────────────────
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

    // ── 3. Idempotence — déjà valide → 200 (RG-CR-010) ──────────────────────
    if (cr.statut === 'valide') {
      return NextResponse.json({ id: cr.id, statut: cr.statut })
    }

    // ── 4. Déjà envoyé → 409 (pas de rétrogradation — TST-K5-03) ────────────
    if (cr.statut === 'envoye') {
      return NextResponse.json(
        { error: 'Ce compte rendu a déjà été envoyé et ne peut pas être revalidé.' },
        { status: 409 },
      )
    }

    // ── 5. UPDATE brouillon → valide ─────────────────────────────────────────
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedCr, error: updateError } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .update({
        statut: 'valide',
        valide_par: userId,
        valide_at: now,
        updated_at: now,
      })
      .eq('id', crId)
      .eq('statut', 'brouillon')
      .select('id, statut, valide_par, valide_at, updated_at')
      .single()

    if (updateError || !updatedCr) {
      // La condition eq('statut', 'brouillon') n'a pas matché → course condition
      logger.warn({ crId, userId }, 'POST cr/valider: statut changé concurrentiellement')
      return NextResponse.json(
        { error: 'Ce compte rendu ne peut plus être validé.' },
        { status: 409 },
      )
    }

    logger.info({ crId, userId }, 'POST cr/valider: CR validé')

    return NextResponse.json(updatedCr)
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'POST cr/valider: erreur')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
