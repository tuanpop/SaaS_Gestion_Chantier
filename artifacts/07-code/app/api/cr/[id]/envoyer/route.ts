// app/api/cr/[id]/envoyer/route.ts — Envoyer un CR (valide → envoye)
// US-042 : envoi email Resend + transition statut valide → envoye
// RG-CR-011 : idempotent si déjà envoye
// TST-K5-06 : IDOR 404 cross-org
// TST-K5-15 : escapeHtml sur toutes les valeurs user
// AM-03 : inclure l'expéditeur dans les destinataires (pas d'exclusion)
// D-5-10 : trial-gate
// PO-5-04 : envoi interne uniquement (admin + conducteur org)

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { resolveDestinatairesInternes } from '@/lib/reporting/destinataires'
import { renderEmail, sendEmail, escapeHtml } from '@/lib/notifications/email-layout'
import { logger } from '@/lib/logger'

interface Params {
  params: Promise<{ id: string }>
}

/** Format date FR pour le corps email : "10 juin 2026" */
function formatDateFr(dateStr: string): string {
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  return `${day} ${months[month - 1]} ${year}`
}

/** Format datetime FR : "10 juin 2026 à 14h32" */
function formatDatetimeFr(isoStr: string): string {
  const d = new Date(isoStr)
  const date = formatDateFr(d.toISOString().split('T')[0]!)
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${date} à ${h}h${m}`
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
      .select('id, statut, organisation_id, chantier_id, date_cr, contenu_genere, valide_par, valide_at')
      .eq('id', crId)
      .eq('organisation_id', organisationId)
      .single()

    if (fetchError || !crRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    const cr = crRaw as unknown as {
      id: string
      statut: string
      organisation_id: string
      chantier_id: string
      date_cr: string
      contenu_genere: string | null
      valide_par: string | null
      valide_at: string | null
    }

    // ── 3. Idempotence — déjà envoyé → 200 (RG-CR-011) ──────────────────────
    if (cr.statut === 'envoye') {
      return NextResponse.json({ id: cr.id, statut: cr.statut })
    }

    // ── 4. Précondition statut=valide → 409 si brouillon ────────────────────
    if (cr.statut !== 'valide') {
      return NextResponse.json(
        { error: 'Ce compte rendu doit être validé avant d\'être envoyé.' },
        { status: 409 },
      )
    }

    // ── 5. Trial-gate (D-5-10) ───────────────────────────────────────────────
    await assertTrialActive(adminClient, organisationId)

    // ── 6. Récupérer infos chantier pour l'email ─────────────────────────────
    const { data: chantierRaw } = await adminClient
      .from('chantiers')
      .select('nom')
      .eq('id', cr.chantier_id)
      .single()

    const chantierNom = (chantierRaw as unknown as { nom: string } | null)?.nom ?? 'Chantier inconnu'

    // ── 7. Récupérer nom validateur ──────────────────────────────────────────
    let validePar = 'Utilisateur'
    if (cr.valide_par) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: userRaw } = await (adminClient as unknown as any)
        .from('users')
        .select('nom, prenom')
        .eq('id', cr.valide_par)
        .single()

      if (userRaw) {
        const u = userRaw as unknown as { nom: string | null; prenom: string | null }
        validePar = [u.prenom, u.nom].filter(Boolean).join(' ') || validePar
      }
    }

    // ── 8. Résoudre destinataires internes (AM-03 : expéditeur inclus) ───────
    // Nouvelle règle PO 2026-06-15 : admins org + conducteurs rattachés au chantier
    const destinataires = await resolveDestinatairesInternes(organisationId, cr.chantier_id, adminClient)

    // ── 9. Construire et envoyer email (TST-K5-15 : escapeHtml obligatoire) ──
    const extrait = (cr.contenu_genere ?? '').slice(0, 300)

    const html = renderEmail({
      bodyTemplate: 'cr-envoye',
      title: `CR journalier — ${chantierNom} — ${formatDateFr(cr.date_cr)}`,
      preheader: `Compte rendu journalier validé pour ${chantierNom} du ${formatDateFr(cr.date_cr)}`,
      vars: {
        CHANTIER_NOM: escapeHtml(chantierNom),
        DATE_CR: escapeHtml(formatDateFr(cr.date_cr)),
        CONTENU_CR_EXTRAIT: escapeHtml(extrait),
        VALIDE_PAR_NOM: escapeHtml(validePar),
        VALIDE_AT: escapeHtml(cr.valide_at ? formatDatetimeFr(cr.valide_at) : '—'),
      },
    })

    if (destinataires.length > 0) {
      await sendEmail({
        to: destinataires,
        subject: `[ClawBTP] CR journalier — ${chantierNom} — ${formatDateFr(cr.date_cr)}`,
        html,
        tag: 'cr-envoye',
      })
    } else {
      logger.warn({ crId, organisationId }, 'POST cr/envoyer: aucun destinataire, email non envoyé')
    }

    // ── 10. Transition valide → envoye + snapshot envoye_a ──────────────────
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedCr, error: updateError } = await (adminClient as unknown as any)
      .from('comptes_rendus')
      .update({
        statut: 'envoye',
        envoye_at: now,
        envoye_a: destinataires.join(','),  // snapshot text (migration 012 : colonne text)
        envoye_par: userId,                 // audit trail — architecture §8 pattern 4 (jwt.sub, jamais body)
        updated_at: now,
      })
      .eq('id', crId)
      .eq('statut', 'valide')
      .select('id, statut, envoye_at, envoye_a, envoye_par, updated_at')
      .single()

    if (updateError || !updatedCr) {
      logger.error({ crId, error: updateError?.message }, 'POST cr/envoyer: erreur update statut')
      // Email déjà envoyé, on remonte l'erreur mais on loggue le décalage
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    logger.info({ crId, destinataires: destinataires.length, userId }, 'POST cr/envoyer: CR envoyé')

    return NextResponse.json(updatedCr)
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYMENT_REQUIRED') {
      return NextResponse.json({ error: 'Votre essai gratuit a expiré.' }, { status: 402 })
    }

    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'POST cr/envoyer: erreur')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
