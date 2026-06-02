// app/api/ouvrier/taches/[id]/route.ts
// PATCH /api/ouvrier/taches/[id] — Changement statut tache par l'ouvrier
//
// Implemente : US-3.7 (demarrer tache), US-3.8 (terminer tache), US-3.9 (signaler blocage)
//              RG-STATUT-001 a 005, D-052/PO-3-05 (bloque→en_cours autorise)
// Items securite :
//   D-3-022 : PatchOuvrierTacheSchema.strict() — rejette note_privee_conducteur (K3-CR-04)
//   K3-E-02 : IDOR — PATCH refuse si tache non assignee a cet ouvrier
//   K3-HI-08 : UPDATE SQL explicite (jamais de spread body)
//   K3-I-05 : reponse shape limitee (id, statut, bloque_raison, updated_at uniquement)
//   D-3-005 : pattern 5 etapes RBAC

// D-3-010 : Node runtime obligatoire (ioredis incompatible Edge)
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { PatchOuvrierTacheSchema } from '@/lib/validation/ouvrier'
import { logger } from '@/lib/logger'

// ============================================================
// Table de transitions autorisees pour l'ouvrier (RG-STATUT-002)
// termine est immuable pour l'ouvrier (RG-STATUT-005)
// D-052/PO-3-05 : bloque → en_cours autorise (L'obstacle est leve)
// ============================================================
const TRANSITIONS_AUTORISEES: Record<string, string[]> = {
  a_faire: ['en_cours', 'bloque', 'termine'],
  en_cours: ['termine', 'bloque'],
  bloque: ['en_cours'],          // D-052/PO-3-05 : bloque → en_cours autorise
  termine: [],                   // immuable pour l'ouvrier (RG-STATUT-005)
}

// ============================================================
// PATCH /api/ouvrier/taches/[id]
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const noStoreHeaders = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

  const { id: tacheId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'PATCH /api/ouvrier/taches/[id]' })

  try {
    // Etape 1 — Validation session Redis (D-3-002, pattern D-3-005 etape 1)
    const session = await getOuvrierSession(request)
    if (!session) {
      return NextResponse.json(
        { error: 'Session expirée. Reconnectez-vous.' },
        { status: 401, headers: noStoreHeaders },
      )
    }

    // Etape 2 — Validation Zod AVANT toute lecture base (D-3-022)
    // .strict() bloque note_privee_conducteur et tout champ inconnu (K3-CR-04 BINDING)
    const bodyRaw: unknown = await request.json()
    const parsed = PatchOuvrierTacheSchema.safeParse(bodyRaw)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Requête invalide.',
          fields: parsed.error.flatten().fieldErrors,
        },
        { status: 400, headers: noStoreHeaders },
      )
    }

    // Extraire UNIQUEMENT les champs valides (jamais de spread body — K3-HI-08)
    const { statut: newStatut, bloque_raison } = parsed.data

    const adminClient = createAdminClient()

    // Etape 3 — Recuperer la tache avec filtre organisation_id (K3-CR-03)
    // AUDIT: SELECT explicite — D-3-004 (note_privee_conducteur exclue)
    const { data: tacheRow, error: tacheError } = await adminClient
      .from('taches')
      .select('id, assigned_to, statut, chantier_id, organisation_id')
      .eq('id', tacheId)
      .eq('organisation_id', session.organisation_id) // K3-CR-03 : filtre org CRITIQUE
      .is('deleted_at', null)
      .single()

    if (tacheError || !tacheRow) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404, headers: noStoreHeaders },
      )
    }

    // Etape 4 — RBAC : verifier que la tache est assignee A CET ouvrier (K3-E-02 BINDING)
    if (tacheRow.assigned_to !== session.user_id) {
      reqLogger.warn(
        {
          userId: session.user_id,
          assignedTo: tacheRow.assigned_to,
          tacheId,
        },
        'PATCH tache ouvrier : IDOR — tache non assignee a cet ouvrier (K3-E-02)',
      )
      return NextResponse.json(
        { error: 'Accès refusé.' },
        { status: 403, headers: noStoreHeaders },
      )
    }

    // Etape 5 — RBAC base affectation active sur le chantier (D-3-005)
    const today = new Date().toISOString().split('T')[0]
    const { data: affCheck } = await adminClient
      .from('affectations')
      .select('id')
      .eq('user_id', session.user_id)
      .eq('chantier_id', tacheRow.chantier_id)
      .eq('organisation_id', session.organisation_id)
      .is('deleted_at', null)
      .or(`date_fin.is.null,date_fin.gte.${today}`)
      .limit(1)

    if (!affCheck || affCheck.length === 0) {
      reqLogger.warn(
        { userId: session.user_id, chantierId: tacheRow.chantier_id },
        'PATCH tache ouvrier : affectation inactive sur ce chantier',
      )
      return NextResponse.json(
        { error: 'Accès refusé.' },
        { status: 403, headers: noStoreHeaders },
      )
    }

    // Etape 6 — Verifier la transition de statut (RG-STATUT-002)
    const currentStatut = tacheRow.statut as string
    const allowedTransitions = TRANSITIONS_AUTORISEES[currentStatut] ?? []

    if (!allowedTransitions.includes(newStatut)) {
      return NextResponse.json(
        {
          error: 'Transition de statut non autorisée.',
          current: currentStatut,
          requested: newStatut,
          allowed: allowedTransitions,
        },
        { status: 400, headers: noStoreHeaders },
      )
    }

    // Etape 7 — Valider bloque_raison selon le nouveau statut
    // RG-STATUT-003 : si statut = bloque → bloque_raison obligatoire (min 3 chars ouvrier)
    // RG-STATUT-004 : si statut != bloque → forcer bloque_raison = null cote serveur
    let finalBloqueRaison: string | null = null

    if (newStatut === 'bloque') {
      const raisonValue = bloque_raison ?? null
      if (!raisonValue || raisonValue.trim().length < 3) {
        return NextResponse.json(
          {
            error: 'Le motif de blocage est requis.',
            fields: { bloque_raison: ['Motif requis (min 3 caractères)'] },
          },
          { status: 400, headers: noStoreHeaders },
        )
      }
      finalBloqueRaison = raisonValue.trim()
    }
    // Si statut != bloque → finalBloqueRaison reste null (RG-STATUT-004 : force null)

    // Etape 8 — UPDATE SQL explicite (K3-HI-08 : JAMAIS de spread body)
    // Colonnes mises a jour : statut + bloque_raison + updated_at uniquement
    // note_privee_conducteur : ne fait PAS partie du UPDATE (defense niveau 3 K3-CR-04)
    const { data: updated, error: updateError } = await adminClient
      .from('taches')
      .update({
        statut: newStatut,
        bloque_raison: finalBloqueRaison,
        // updated_at : gere par trigger DB (pas besoin de le passer)
      })
      .eq('id', tacheId)
      .eq('organisation_id', session.organisation_id)
      .select('id, statut, bloque_raison, updated_at')
      .single()

    if (updateError || !updated) {
      reqLogger.error(
        { err: updateError?.message, tacheId },
        'PATCH tache ouvrier : erreur UPDATE',
      )
      return NextResponse.json(
        { error: 'Erreur interne.' },
        { status: 500, headers: noStoreHeaders },
      )
    }

    reqLogger.info(
      { tacheId, oldStatut: currentStatut, newStatut, userId: session.user_id },
      'Tache ouvrier mise a jour',
    )

    // Etape 9 — Reponse shape limitee (K3-I-05 : 4 champs uniquement)
    // JAMAIS retourner description, bloque_raison du conducteur, ou d'autres champs
    const responseBody = {
      id: updated.id,
      statut: updated.statut,
      bloque_raison: updated.bloque_raison,
      updated_at: updated.updated_at,
    }

    return NextResponse.json(responseBody, { status: 200, headers: noStoreHeaders })
  } catch (error) {
    reqLogger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'PATCH /api/ouvrier/taches/[id] : erreur non geree',
    )
    return NextResponse.json(
      { error: 'Erreur interne.' },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
