// app/api/cr/[id]/pdf/route.ts — Export PDF Compte Rendu
// US-043 : téléchargement PDF à la demande
// D-5-07 : renderToBuffer, pas de stockage (on-demand)
// RG-PDF-001 : 409 si statut=brouillon
// TST-K5-06 : IDOR 404 cross-org
// SURF-5-10 : contenu en <Text>, jamais dangerouslySetInnerHTML

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { CrDocument } from '@/lib/reporting/pdf/CrDocument'
import { buildCrFilename } from '@/lib/reporting/filename'
import { logger } from '@/lib/logger'
import type { CompteRendu } from '@/types/reporting'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: Params) {
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
      .select('id, chantier_id, organisation_id, date_cr, statut, contenu_genere, declenche_par, valide_par, valide_at, envoye_at, envoye_a')
      .eq('id', crId)
      .eq('organisation_id', organisationId)
      .single()

    if (fetchError || !crRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    const cr = crRaw as unknown as CompteRendu

    // ── 3. Précondition statut ≠ brouillon (RG-PDF-001) ─────────────────────
    if (cr.statut === 'brouillon') {
      return NextResponse.json(
        { error: 'Le PDF n\'est disponible qu\'une fois le compte rendu validé.' },
        { status: 409 },
      )
    }

    // ── 4. Récupérer infos chantier ──────────────────────────────────────────
    const { data: chantierRaw } = await adminClient
      .from('chantiers')
      .select('nom, organisation_id')
      .eq('id', cr.chantier_id)
      .single()

    const chantierNom = (chantierRaw as unknown as { nom: string } | null)?.nom ?? 'Chantier inconnu'

    // ── 5. Récupérer nom organisation ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgRaw } = await (adminClient as unknown as any)
      .from('organisations')
      .select('nom')
      .eq('id', organisationId)
      .single()

    const organisationNom = (orgRaw as unknown as { nom: string } | null)?.nom ?? 'Organisation inconnue'

    // ── 6. Récupérer nom validateur ──────────────────────────────────────────
    let conducteurNom: string | null = null
    if (cr.valide_par) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: userRaw } = await (adminClient as unknown as any)
        .from('users')
        .select('nom, prenom')
        .eq('id', cr.valide_par)
        .single()

      if (userRaw) {
        const u = userRaw as unknown as { nom: string | null; prenom: string | null }
        conducteurNom = [u.prenom, u.nom].filter(Boolean).join(' ') || null
      }
    }

    // ── 7. Générer PDF buffer (D-5-07 — renderToBuffer, pas de stockage) ─────
    // Cast requis : react-pdf v4 attend ReactElement<DocumentProps> mais createElement
    // retourne FunctionComponentElement<CrDocumentProps> — incompatibilité exactOptionalPropertyTypes
    const pdfBuffer = await renderToBuffer(
      React.createElement(CrDocument, {
        cr,
        chantierNom,
        organisationNom,
        conducteurNom,
      }) as unknown as Parameters<typeof renderToBuffer>[0],
    )

    // ── 8. Construire filename safe ──────────────────────────────────────────
    const filename = buildCrFilename(chantierNom, cr.date_cr)

    logger.info({ crId, filename, userId }, 'GET cr/pdf: PDF généré')

    // Buffer -> ArrayBuffer pour satisfaire BodyInit (NextResponse n'accepte pas Buffer directement)
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength,
    ) as ArrayBuffer

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuffer.length),
        // Pas de cache — document métier sensible
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'GET cr/pdf: erreur')
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
