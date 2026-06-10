// app/api/rapports-hebdo/[id]/pdf/route.ts — Export PDF Rapport Hebdomadaire
// US-046 : téléchargement PDF à la demande
// D-5-07 : renderToBuffer, pas de stockage (on-demand)
// RG-PDF-001 : 409 si statut=brouillon
// TST-K5-06 : IDOR 404 cross-org
// SURF-5-10 : contenu en <Text>

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { HebdoDocument } from '@/lib/reporting/pdf/HebdoDocument'
import { buildHebdoFilename } from '@/lib/reporting/filename'
import { logger } from '@/lib/logger'
import type { RapportHebdo } from '@/types/reporting'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: Params) {
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
      .select('id, chantier_id, organisation_id, annee_iso, semaine_iso, statut, contenu_genere, cr_ids, valide_par, valide_at, envoye_at, envoye_a')
      .eq('id', rapportId)
      .eq('organisation_id', organisationId)
      .single()

    if (fetchError || !rapportRaw) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    const rapport = rapportRaw as unknown as RapportHebdo

    // ── 3. Précondition statut ≠ brouillon (RG-PDF-001) ─────────────────────
    if (rapport.statut === 'brouillon') {
      return NextResponse.json(
        { error: 'Le PDF n\'est disponible qu\'une fois le rapport validé.' },
        { status: 409 },
      )
    }

    // ── 4. Infos chantier ─────────────────────────────────────────────────────
    const { data: chantierRaw } = await adminClient
      .from('chantiers')
      .select('nom')
      .eq('id', rapport.chantier_id)
      .single()

    const chantierNom = (chantierRaw as unknown as { nom: string } | null)?.nom ?? 'Chantier inconnu'

    // ── 5. Infos organisation ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgRaw } = await (adminClient as unknown as any)
      .from('organisations')
      .select('nom')
      .eq('id', organisationId)
      .single()

    const organisationNom = (orgRaw as unknown as { nom: string } | null)?.nom ?? 'Organisation inconnue'

    // ── 6. Nom validateur ─────────────────────────────────────────────────────
    let conducteurNom: string | null = null
    if (rapport.valide_par) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: userRaw } = await (adminClient as unknown as any)
        .from('users')
        .select('nom, prenom')
        .eq('id', rapport.valide_par)
        .single()

      if (userRaw) {
        const u = userRaw as unknown as { nom: string | null; prenom: string | null }
        conducteurNom = [u.prenom, u.nom].filter(Boolean).join(' ') || null
      }
    }

    // ── 7. Générer PDF buffer ─────────────────────────────────────────────────
    // Cast requis : react-pdf v4 attend ReactElement<DocumentProps> mais createElement
    // retourne FunctionComponentElement<HebdoDocumentProps> — incompatibilité exactOptionalPropertyTypes
    const pdfBuffer = await renderToBuffer(
      React.createElement(HebdoDocument, {
        rapport,
        chantierNom,
        organisationNom,
        conducteurNom,
      }) as unknown as Parameters<typeof renderToBuffer>[0],
    )

    // ── 8. Filename safe ──────────────────────────────────────────────────────
    const filename = buildHebdoFilename(chantierNom, rapport.annee_iso, rapport.semaine_iso)

    logger.info({ rapportId, filename, userId }, 'GET rapports-hebdo/pdf: PDF généré')

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
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'GET rapports-hebdo/pdf: erreur',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
