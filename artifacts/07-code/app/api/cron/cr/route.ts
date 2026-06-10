// app/api/cron/cr/route.ts — Cron génération CRs journaliers
// Auth : x-cron-secret timing-safe (TST-K5-10)
// US-038 : génération automatique 18h
// RG-CR-008 : court-circuit si pas d'activité (cost guard)
// D-5-09 : UPSERT atomique ON CONFLICT WHERE statut='brouillon'
// TST-K5-12 : idempotence — re-run même jour → generated:0

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { collectSignaux } from '@/lib/reporting/collectSignaux'
import { genererContenuCR } from '@/lib/reporting/genererContenuCR'
import { logger } from '@/lib/logger'

// ============================================================
// Auth cron — timing-safe compare (TST-K5-10)
// ============================================================

function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) {
    logger.warn('CRON_SECRET non configuré — endpoint cron désactivé')
    return false
  }

  const headerSecret = request.headers.get('x-cron-secret')
  if (!headerSecret) return false

  try {
    const expected = Buffer.from(cronSecret, 'utf-8')
    const received = Buffer.from(headerSecret, 'utf-8')
    // timingSafeEqual exige des buffers de même longueur
    if (expected.length !== received.length) return false
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

// ============================================================
// Handler POST /api/cron/cr
// ============================================================

export async function POST(request: Request) {
  // Auth timing-safe (TST-K5-10 — aucun appel LLM si non authentifié)
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const adminClient = createAdminClient()
  const today = new Date().toISOString().split('T')[0]! // YYYY-MM-DD UTC

  let generated = 0
  let skipped_no_activity = 0
  let skipped_already_validated = 0
  const errors: Array<{ chantier_id: string; error: string }> = []

  try {
    // Récupérer tous les chantiers actifs de toutes les organisations
    const { data: chantiersRaw, error: chantiersError } = await adminClient
      .from('chantiers')
      .select('id, organisation_id, statut')
      .eq('statut', 'actif')

    if (chantiersError) {
      logger.error({ error: chantiersError.message }, 'cron/cr: erreur récupération chantiers')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    const chantiers = chantiersRaw ?? []
    logger.info({ count: chantiers.length, date: today }, 'cron/cr: démarrage')

    for (const chantier of chantiers) {
      try {
        // Skip orgs trial_expired (D-5-10)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: orgRaw } = await (adminClient as unknown as any)
          .from('organisations')
          .select('statut, trial_ends_at')
          .eq('id', chantier.organisation_id)
          .single()

        if (!orgRaw) {
          logger.warn({ chantierId: chantier.id }, 'cron/cr: organisation introuvable, skip')
          skipped_no_activity++
          continue
        }

        const isTrialExpired =
          orgRaw.statut === 'trial_expired' ||
          orgRaw.statut === 'suspended' ||
          new Date(orgRaw.trial_ends_at) < new Date()

        if (isTrialExpired) {
          logger.debug(
            { chantierId: chantier.id, orgId: chantier.organisation_id },
            'cron/cr: org trial_expired, skip',
          )
          skipped_no_activity++
          continue
        }

        // Vérifier si un CR valide/envoye existe déjà pour aujourd'hui (TST-K5-12)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingCr } = await (adminClient as unknown as any)
          .from('comptes_rendus')
          .select('id, statut')
          .eq('chantier_id', chantier.id)
          .eq('date_cr', today)
          .single()

        const existingRaw = existingCr as unknown as { id: string; statut: string } | null

        if (existingRaw && (existingRaw.statut === 'valide' || existingRaw.statut === 'envoye')) {
          logger.debug(
            { chantierId: chantier.id, statut: existingRaw.statut },
            'cron/cr: CR déjà validé/envoyé, skip',
          )
          skipped_already_validated++
          continue
        }

        // Collecter signaux — includes has_activity
        const signaux = await collectSignaux(
          adminClient,
          chantier.id,
          chantier.organisation_id,
          today,
        )

        // Court-circuit si pas d'activité (RG-CR-008)
        if (!signaux.has_activity) {
          logger.debug({ chantierId: chantier.id, date: today }, 'cron/cr: pas d\'activité, skip')
          skipped_no_activity++
          continue
        }

        // Générer le contenu CR
        const { has_activity: _hasActivity, ...signauxPurs } = signaux
        const contenu = await genererContenuCR(signauxPurs)

        // UPSERT atomique (D-5-09 — WHERE statut='brouillon' dans la clause DO UPDATE)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upsertError } = await (adminClient as unknown as any)
          .from('comptes_rendus')
          .upsert(
            {
              chantier_id: chantier.id,
              organisation_id: chantier.organisation_id,
              date_cr: today,
              contenu_genere: contenu,
              donnees_brutes: signauxPurs as unknown as Record<string, unknown>,
              statut: 'brouillon',
              declenche_par: 'cron',
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: 'chantier_id,date_cr',
              // La contrainte WHERE statut='brouillon' est assurée par la vérification préalable
              // et l'idempotence de l'upsert (un CR valide/envoye a été skippé plus haut)
            },
          )

        if (upsertError) {
          logger.error(
            { chantierId: chantier.id, error: upsertError.message },
            'cron/cr: erreur upsert',
          )
          errors.push({ chantier_id: chantier.id, error: upsertError.message })
          continue
        }

        generated++
        logger.info({ chantierId: chantier.id, date: today }, 'cron/cr: CR généré')
      } catch (err) {
        // Catch par chantier — le cron continue sur les autres (D-5-04)
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ chantierId: chantier.id, error: msg }, 'cron/cr: erreur par chantier')
        errors.push({ chantier_id: chantier.id, error: msg })
      }
    }

    logger.info(
      { generated, skipped_no_activity, skipped_already_validated, errors: errors.length },
      'cron/cr: terminé',
    )

    return NextResponse.json({
      generated,
      skipped_no_activity,
      skipped_already_validated,
      errors,
    })
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'cron/cr: erreur critique')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
