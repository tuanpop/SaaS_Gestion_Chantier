// app/api/chantiers/[id]/cr/generer/route.ts — Génération manuelle CR
// US-039 : déclenchement manuel par admin/conducteur
// Auth : JWT claims headers middleware
// TST-K5-11 : rate-limit 10/h/userId
// RG-CR-006 : 409 si CR valide/envoye
// RG-CR-012 : 409 si chantier archivé
// D-5-09 : UPSERT atomique ON CONFLICT WHERE statut='brouillon'

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { collectSignaux } from '@/lib/reporting/collectSignaux'
import { genererContenuCR } from '@/lib/reporting/genererContenuCR'
import { assertTrialActive } from '@/lib/trial-gate'
import { checkRateLimit } from '@/lib/cache'
import { GenererCrBodySchema } from '@/lib/validation/reporting'
import { logger } from '@/lib/logger'
import { LLMError } from '@/lib/llm/client'

interface Params {
  params: Promise<{ id: string }>
}

// Rate-limit 10/h/userId pour la génération manuelle (TST-K5-11, §7.1 archi)
const CR_GENERER_RATE_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 }

export async function POST(request: Request, { params }: Params) {
  try {
    // ── 1. Auth — claims headers middleware ──────────────────────────────────
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const chantierId = (await params).id

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // Rôle : admin ou conducteur uniquement (ouvrier → 403)
    if (userRole !== 'admin' && userRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // ── 2. Rate-limit (TST-K5-11) ─────────────────────────────────────────────
    const rateLimitResult = checkRateLimit({
      key: `cr:generer:${userId}`,
      ...CR_GENERER_RATE_LIMIT,
    })

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.' },
        { status: 429 },
      )
    }

    // ── 3. Validation input ───────────────────────────────────────────────────
    let body: Record<string, unknown> = {}
    try {
      const text = await request.text()
      if (text) body = JSON.parse(text)
    } catch {
      // Corps vide ou non-JSON — date_cr sera générée par défaut
    }

    const parsed = GenererCrBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Requête invalide.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    // Date CR : fournie ou aujourd'hui UTC
    const dateCr = parsed.data.date_cr ?? new Date().toISOString().split('T')[0]!

    const adminClient = createAdminClient()

    // ── 4. Ownership chantier (IDOR 404 — jamais 403) ────────────────────────
    const { data: chantierRaw, error: chantierError } = await adminClient
      .from('chantiers')
      .select('id, organisation_id, statut')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (chantierError || !chantierRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // ── 5. Chantier archivé → 409 (RG-CR-012) ───────────────────────────────
    if (chantierRaw.statut === 'archive') {
      return NextResponse.json(
        { error: 'Le chantier est archivé. Impossible de générer un CR.' },
        { status: 409 },
      )
    }

    // ── 6. Trial-gate (D-5-10) ───────────────────────────────────────────────
    await assertTrialActive(adminClient, organisationId)

    // ── 7. Vérification CR valide/envoye existant (RG-CR-006) ────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingCr } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .select('id, statut')
      .eq('chantier_id', chantierId)
      .eq('date_cr', dateCr)
      .single()

    const existingCrRaw = existingCr as unknown as { id: string; statut: string } | null

    if (existingCrRaw && (existingCrRaw.statut === 'valide' || existingCrRaw.statut === 'envoye')) {
      return NextResponse.json(
        { error: 'Ce compte rendu est déjà validé et ne peut pas être régénéré.' },
        { status: 409 },
      )
    }

    // ── 8. Collecte signaux ───────────────────────────────────────────────────
    const signaux = await collectSignaux(adminClient, chantierId, organisationId, dateCr)
    const { has_activity: _hasActivity, ...signauxPurs } = signaux

    // ── 9. Génération LLM ─────────────────────────────────────────────────────
    const contenu = await genererContenuCR(signauxPurs)

    // ── 10. UPSERT atomique (D-5-09) ──────────────────────────────────────────
    const isFirstCr = !existingCrRaw
    const now = new Date().toISOString()

    const upsertData = {
      chantier_id: chantierId,
      organisation_id: organisationId,
      date_cr: dateCr,
      contenu_genere: contenu,
      donnees_brutes: signauxPurs as unknown as Record<string, unknown>,
      statut: 'brouillon',
      declenche_par: 'manuel',
      updated_at: now,
      ...(isFirstCr && { created_at: now }),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: upsertedCr, error: upsertError } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .upsert(upsertData, { onConflict: 'chantier_id,date_cr' })
      .select('id, chantier_id, date_cr, statut, contenu_genere, declenche_par, created_at, updated_at')
      .single()

    if (upsertError) {
      logger.error(
        { chantierId, dateCr, error: upsertError.message },
        'POST cr/generer: erreur upsert',
      )
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    logger.info(
      { chantierId, dateCr, isFirstCr, userId },
      'POST cr/generer: CR généré',
    )

    return NextResponse.json(upsertedCr, { status: isFirstCr ? 201 : 200 })
  } catch (err) {
    if (err instanceof LLMError) {
      logger.error(
        { error: err.message, isTimeout: err.isTimeout },
        'POST cr/generer: LLM indisponible',
      )
      return NextResponse.json(
        { error: 'Le service de génération est temporairement indisponible.' },
        { status: 502 },
      )
    }

    // PaymentRequiredError (assertTrialActive)
    if (err instanceof Error && err.message === 'PAYMENT_REQUIRED') {
      return NextResponse.json({ error: 'Votre essai gratuit a expiré.' }, { status: 402 })
    }

    // Catch-all via toApiResponse pattern
    const { toApiResponse } = await import('@/lib/errors')
    return toApiResponse(err)
  }
}
