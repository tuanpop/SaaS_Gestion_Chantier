// app/api/rapports-hebdo/[id]/envoyer/route.ts — Envoyer un rapport hebdo (valide → envoye)
// US-046 : envoi email Resend + transition statut
// RG-RH-006 : idempotent si déjà envoye
// TST-K5-06 : IDOR 404 cross-org
// TST-K5-15 : escapeHtml sur toutes les valeurs user
// AM-03 : inclure l'expéditeur dans les destinataires

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { resolveDestinatairesInternes } from '@/lib/reporting/destinataires'
import { renderEmail, sendEmail, escapeHtml } from '@/lib/notifications/email-layout'
import { formatSemaineLabel } from '@/lib/reporting/isoWeek'
import { logger } from '@/lib/logger'

interface Params {
  params: Promise<{ id: string }>
}

/** Format datetime FR : "10 juin 2026 à 14h32" */
function formatDatetimeFr(isoStr: string): string {
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  const d = new Date(isoStr)
  const day = d.getUTCDate()
  const month = months[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year} à ${h}h${m}`
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

    // ── 2. Ownership 404 cross-org (TST-K5-06) ───────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rapportRaw, error: fetchError } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .select('id, statut, organisation_id, chantier_id, annee_iso, semaine_iso, contenu_genere, valide_par, valide_at')
      .eq('id', rapportId)
      .eq('organisation_id', organisationId)
      .single()

    if (fetchError || !rapportRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    const rapport = rapportRaw as unknown as {
      id: string
      statut: string
      organisation_id: string
      chantier_id: string
      annee_iso: number
      semaine_iso: number
      contenu_genere: string | null
      valide_par: string | null
      valide_at: string | null
    }

    // ── 3. Idempotence — déjà envoyé → 200 (RG-RH-006) ──────────────────────
    if (rapport.statut === 'envoye') {
      return NextResponse.json({ id: rapport.id, statut: rapport.statut })
    }

    // ── 4. Précondition statut=valide → 409 si brouillon ────────────────────
    if (rapport.statut !== 'valide') {
      return NextResponse.json(
        { error: 'Ce rapport doit être validé avant d\'être envoyé.' },
        { status: 409 },
      )
    }

    // ── 5. Trial-gate ────────────────────────────────────────────────────────
    await assertTrialActive(adminClient, organisationId)

    // ── 6. Infos chantier ────────────────────────────────────────────────────
    const { data: chantierRaw } = await adminClient
      .from('chantiers')
      .select('nom')
      .eq('id', rapport.chantier_id)
      .single()

    const chantierNom = (chantierRaw as unknown as { nom: string } | null)?.nom ?? 'Chantier inconnu'

    // ── 7. Nom validateur ─────────────────────────────────────────────────────
    let validePar = 'Utilisateur'
    if (rapport.valide_par) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: userRaw } = await (adminClient as unknown as any)
        .from('users')
        .select('nom, prenom')
        .eq('id', rapport.valide_par)
        .single()

      if (userRaw) {
        const u = userRaw as unknown as { nom: string | null; prenom: string | null }
        validePar = [u.prenom, u.nom].filter(Boolean).join(' ') || validePar
      }
    }

    // ── 8. Destinataires internes (AM-03 : expéditeur inclus) ────────────────
    const destinataires = await resolveDestinatairesInternes(organisationId, adminClient)

    // ── 9. Email (TST-K5-15 : escapeHtml obligatoire) ─────────────────────────
    const semaineLabel = formatSemaineLabel(rapport.annee_iso, rapport.semaine_iso)
    const extrait = (rapport.contenu_genere ?? '').slice(0, 300)

    const html = renderEmail({
      bodyTemplate: 'rapport-hebdo-envoye',
      title: `Rapport hebdo — ${chantierNom} — ${semaineLabel}`,
      preheader: `Rapport hebdomadaire validé pour ${chantierNom} — ${semaineLabel}`,
      vars: {
        CHANTIER_NOM: escapeHtml(chantierNom),
        SEMAINE_LABEL: escapeHtml(semaineLabel),
        CONTENU_EXTRAIT: escapeHtml(extrait),
        VALIDE_PAR_NOM: escapeHtml(validePar),
        VALIDE_AT: escapeHtml(rapport.valide_at ? formatDatetimeFr(rapport.valide_at) : '—'),
      },
    })

    if (destinataires.length > 0) {
      await sendEmail({
        to: destinataires,
        subject: `[ClawBTP] Rapport hebdo — ${chantierNom} — ${semaineLabel}`,
        html,
        tag: 'rapport-hebdo-envoye',
      })
    } else {
      logger.warn({ rapportId, organisationId }, 'POST rapports-hebdo/envoyer: aucun destinataire')
    }

    // ── 10. Transition valide → envoye + snapshot envoye_a ──────────────────
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedRapport, error: updateError } = await (adminClient as unknown as any)
      .from('rapports_hebdo')
      .update({
        statut: 'envoye',
        envoye_at: now,
        envoye_a: destinataires.join(','),  // snapshot text (migration 013 : colonne text)
        envoye_par: userId,                 // audit trail — architecture §8 pattern 4 (jwt.sub, jamais body)
        updated_at: now,
      })
      .eq('id', rapportId)
      .eq('statut', 'valide')
      .select('id, statut, envoye_at, envoye_a, envoye_par, updated_at')
      .single()

    if (updateError || !updatedRapport) {
      logger.error({ rapportId, error: updateError?.message }, 'POST rapports-hebdo/envoyer: erreur update statut')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    logger.info({ rapportId, destinataires: destinataires.length, userId }, 'POST rapports-hebdo/envoyer: rapport envoyé')

    return NextResponse.json(updatedRapport)
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYMENT_REQUIRED') {
      return NextResponse.json({ error: 'Votre essai gratuit a expiré.' }, { status: 402 })
    }

    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'POST rapports-hebdo/envoyer: erreur',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
