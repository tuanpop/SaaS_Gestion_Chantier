// app/api/cron/rapports-hebdo/route.ts — Cron génération rapports hebdo
// Auth : x-cron-secret timing-safe
// US-045 : génération automatique lundi 07h15 (AM-01 — ligne distincte)
// RG-RH-002 : semaine ISO précédente
// D-5-09 : UPSERT atomique ON CONFLICT WHERE statut='brouillon'

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { collectSignaux } from '@/lib/reporting/collectSignaux'
import { genererContenuHebdo } from '@/lib/reporting/genererRapportHebdo'
import { getPreviousIsoWeek, getWeekBounds } from '@/lib/reporting/isoWeek'
import { logger } from '@/lib/logger'
import type { HebdoInput, CrResume } from '@/types/reporting'

// ============================================================
// Auth cron — timing-safe compare
// ============================================================

function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env['CRON_SECRET']
  if (!cronSecret) return false

  const headerSecret = request.headers.get('x-cron-secret')
  if (!headerSecret) return false

  try {
    const expected = Buffer.from(cronSecret, 'utf-8')
    const received = Buffer.from(headerSecret, 'utf-8')
    if (expected.length !== received.length) return false
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

// ============================================================
// Handler POST /api/cron/rapports-hebdo
// ============================================================

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const adminClient = createAdminClient()
  const now = new Date()
  const { anneeIso, semaineIso } = getPreviousIsoWeek(now)
  const { lundi, dimanche } = getWeekBounds(anneeIso, semaineIso)

  let generated = 0
  let skipped_no_cr = 0
  let skipped_already_validated = 0
  const errors: Array<{ chantier_id: string; error: string }> = []

  try {
    // Récupérer tous les chantiers actifs
    const { data: chantiersRaw, error: chantiersError } = await adminClient
      .from('chantiers')
      .select('id, organisation_id, nom, budget_alloue, budget_depense, date_fin_prevue')
      .eq('statut', 'actif')

    if (chantiersError) {
      logger.error({ error: chantiersError.message }, 'cron/rapports-hebdo: erreur récupération chantiers')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    const chantiers = chantiersRaw ?? []
    logger.info(
      { count: chantiers.length, anneeIso, semaineIso, lundi, dimanche },
      'cron/rapports-hebdo: démarrage',
    )

    for (const chantier of chantiers) {
      try {
        // Skip orgs trial_expired
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: orgRaw } = await (adminClient as unknown as any)
          .from('organisations')
          .select('statut, trial_ends_at')
          .eq('id', chantier.organisation_id)
          .single()

        if (!orgRaw) continue

        const isTrialExpired =
          orgRaw.statut === 'trial_expired' ||
          orgRaw.statut === 'suspended' ||
          new Date(orgRaw.trial_ends_at) < new Date()

        if (isTrialExpired) {
          skipped_no_cr++
          continue
        }

        // Vérifier si un rapport valide/envoye existe déjà
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingRapport } = await (adminClient as unknown as any)
          .from('rapports_hebdo')
          .select('id, statut')
          .eq('chantier_id', chantier.id)
          .eq('annee_iso', anneeIso)
          .eq('semaine_iso', semaineIso)
          .single()

        const existingRaw = existingRapport as unknown as { id: string; statut: string } | null

        if (existingRaw && (existingRaw.statut === 'valide' || existingRaw.statut === 'envoye')) {
          skipped_already_validated++
          continue
        }

        // Récupérer les CRs validés de la semaine (RG-RH-003)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: crsRaw } = await (adminClient as unknown as any)
          .from('comptes_rendus')
          .select('id, date_cr, contenu_genere, statut')
          .eq('chantier_id', chantier.id)
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

        if (crsValides.length === 0) {
          logger.debug(
            { chantierId: chantier.id, anneeIso, semaineIso },
            'cron/rapports-hebdo: aucun CR validé, skip',
          )
          skipped_no_cr++
          continue
        }

        // Budget fin de semaine via collectSignaux (déterministe D-008)
        const signaux = await collectSignaux(adminClient, chantier.id, chantier.organisation_id, dimanche)

        // Préparer l'input hebdo
        const crs: CrResume[] = crsValides
          .filter((cr) => cr.contenu_genere !== null)
          .map((cr) => ({
            date_cr: cr.date_cr,
            contenu_genere: cr.contenu_genere!,
          }))

        const input: HebdoInput = {
          chantierId: chantier.id,
          chantierNom: chantier.nom,
          anneeIso,
          semaineIso,
          lundiDate: lundi,
          dimancheDate: dimanche,
          crs,
          budgetFinSemaine: signaux.budget,
        }

        const contenu = await genererContenuHebdo(input)
        const crIds = crsValides.map((cr) => cr.id)

        // UPSERT atomique
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upsertError } = await (adminClient as unknown as any)
          .from('rapports_hebdo')
          .upsert(
            {
              chantier_id: chantier.id,
              organisation_id: chantier.organisation_id,
              annee_iso: anneeIso,
              semaine_iso: semaineIso,
              cr_ids: crIds,
              contenu_genere: contenu,
              statut: 'brouillon',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'chantier_id,annee_iso,semaine_iso' },
          )

        if (upsertError) {
          logger.error(
            { chantierId: chantier.id, error: upsertError.message },
            'cron/rapports-hebdo: erreur upsert',
          )
          errors.push({ chantier_id: chantier.id, error: upsertError.message })
          continue
        }

        generated++
        logger.info(
          { chantierId: chantier.id, anneeIso, semaineIso },
          'cron/rapports-hebdo: rapport généré',
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ chantierId: chantier.id, error: msg }, 'cron/rapports-hebdo: erreur par chantier')
        errors.push({ chantier_id: chantier.id, error: msg })
      }
    }

    logger.info(
      { generated, skipped_no_cr, skipped_already_validated, errors: errors.length },
      'cron/rapports-hebdo: terminé',
    )

    return NextResponse.json({
      generated,
      skipped_no_cr,
      skipped_already_validated,
      errors,
    })
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'cron/rapports-hebdo: erreur critique',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
