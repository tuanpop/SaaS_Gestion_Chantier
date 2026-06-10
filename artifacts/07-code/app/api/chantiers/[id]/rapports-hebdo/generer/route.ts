// app/api/chantiers/[id]/rapports-hebdo/generer/route.ts — Génération manuelle rapport hebdo
// US-045 : déclenchement manuel admin/conducteur
// RG-RH-003 : agrège CRs valide/envoye de la semaine ISO saisie
// D-5-09 : UPSERT atomique ON CONFLICT (chantier_id, annee_iso, semaine_iso)
// TST-K5-06 : IDOR 404
// D-5-10 : trial-gate

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { collectSignaux } from '@/lib/reporting/collectSignaux'
import { genererContenuHebdo } from '@/lib/reporting/genererRapportHebdo'
import { getWeekBounds } from '@/lib/reporting/isoWeek'
import { assertTrialActive } from '@/lib/trial-gate'
import { GenererHebdoBodySchema } from '@/lib/validation/reporting'
import { LLMError } from '@/lib/llm/client'
import { logger } from '@/lib/logger'
import type { HebdoInput, CrResume } from '@/types/reporting'

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: Params) {
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

    // ── 2. Validation body ────────────────────────────────────────────────────
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }

    const parsed = GenererHebdoBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Requête invalide.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { annee_iso: anneeIso, semaine_iso: semaineIso } = parsed.data

    const adminClient = createAdminClient()

    // ── 3. Ownership 404 (TST-K5-06) ────────────────────────────────────────
    const { data: chantierRaw, error: chantierError } = await adminClient
      .from('chantiers')
      .select('id, organisation_id, nom, statut')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (chantierError || !chantierRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // ── 4. Chantier archivé → 409 ────────────────────────────────────────────
    if (chantierRaw.statut === 'archive') {
      return NextResponse.json(
        { error: 'Le chantier est archivé. Impossible de générer un rapport hebdo.' },
        { status: 409 },
      )
    }

    // ── 5. Rapport valide/envoye existant → 409 ──────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRapport } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .select('id, statut')
      .eq('chantier_id', chantierId)
      .eq('annee_iso', anneeIso)
      .eq('semaine_iso', semaineIso)
      .single()

    const existingRaw = existingRapport as unknown as { id: string; statut: string } | null

    if (existingRaw && (existingRaw.statut === 'valide' || existingRaw.statut === 'envoye')) {
      return NextResponse.json(
        { error: 'Ce rapport hebdomadaire est déjà validé et ne peut pas être régénéré.' },
        { status: 409 },
      )
    }

    // ── 6. Trial-gate (D-5-10) ───────────────────────────────────────────────
    await assertTrialActive(adminClient, organisationId)

    // ── 7. Bornes de la semaine ──────────────────────────────────────────────
    const { lundi, dimanche } = getWeekBounds(anneeIso, semaineIso)

    // ── 8. CRs validés de la semaine (RG-RH-003) ────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: crsRaw } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .select('id, date_cr, contenu_genere, statut')
      .eq('chantier_id', chantierId)
      .gte('date_cr', lundi)
      .lte('date_cr', dimanche)
      .in('statut', ['valide', 'envoye'])
      .order('date_cr', { ascending: true })

    const crsValides = (crsRaw ?? []) as unknown as Array<{
      id: string
      date_cr: string
      contenu_genere: string | null
      statut: string
    }>

    // RG-RH-003 : si aucun CR validé, le rapport est créé avec cr_ids=[] et contenu "Aucun CR validé"
    // (genererContenuHebdo gère le cas crs=[] via buildCRsBlock → <aucun_cr>)
    // Le 422 précédent contredisait RG-RH-003 et l'archi §6 (422 absent des codes documentés).

    // ── 9. Budget fin de semaine ─────────────────────────────────────────────
    const signaux = await collectSignaux(adminClient, chantierId, organisationId, dimanche)

    // ── 10. Génération LLM ────────────────────────────────────────────────────
    const crs: CrResume[] = crsValides
      .filter((cr) => cr.contenu_genere !== null)
      .map((cr) => ({
        date_cr: cr.date_cr,
        contenu_genere: cr.contenu_genere!,
      }))

    const input: HebdoInput = {
      chantierId,
      chantierNom: chantierRaw.nom,
      anneeIso,
      semaineIso,
      lundiDate: lundi,
      dimancheDate: dimanche,
      crs,
      budgetFinSemaine: signaux.budget,
    }

    const contenu = await genererContenuHebdo(input)
    const crIds = crsValides.map((cr) => cr.id)
    const isFirst = !existingRaw
    const now = new Date().toISOString()

    // ── 11. UPSERT atomique (D-5-09) ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: upsertedRapport, error: upsertError } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .upsert(
        {
          chantier_id: chantierId,
          organisation_id: organisationId,
          annee_iso: anneeIso,
          semaine_iso: semaineIso,
          cr_ids: crIds,
          contenu_genere: contenu,
          statut: 'brouillon',
          updated_at: now,
          ...(isFirst && { created_at: now }),
        },
        { onConflict: 'chantier_id,annee_iso,semaine_iso' },
      )
      .select('id, chantier_id, annee_iso, semaine_iso, statut, cr_ids, contenu_genere, created_at, updated_at')
      .single()

    if (upsertError) {
      logger.error(
        { chantierId, anneeIso, semaineIso, error: upsertError.message },
        'POST rapports-hebdo/generer: erreur upsert',
      )
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    logger.info({ chantierId, anneeIso, semaineIso, isFirst, userId }, 'POST rapports-hebdo/generer: rapport généré')

    return NextResponse.json(upsertedRapport, { status: isFirst ? 201 : 200 })
  } catch (err) {
    if (err instanceof LLMError) {
      logger.error({ error: err.message, isTimeout: err.isTimeout }, 'POST rapports-hebdo/generer: LLM indisponible')
      return NextResponse.json(
        { error: 'Le service de génération est temporairement indisponible.' },
        { status: 502 },
      )
    }

    if (err instanceof Error && err.message === 'PAYMENT_REQUIRED') {
      return NextResponse.json({ error: 'Votre essai gratuit a expiré.' }, { status: 402 })
    }

    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'POST rapports-hebdo/generer: erreur')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
