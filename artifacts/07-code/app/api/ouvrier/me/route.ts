// app/api/ouvrier/me/route.ts
// GET /api/ouvrier/me — Informations session ouvrier courante enrichies depuis Supabase
//
// Implemente : US-3.5 (multi-affectations → selecteur), specs §4.3
// Items securite : D-3-005 (pattern 5 etapes), D-3-010 (nodejs runtime),
//                  D-3-004 (SELECT explicite), K3-I-03 (seulement session courante),
//                  K3-I-04 (Cache-Control: no-store)

// D-3-010 : Node runtime obligatoire (ioredis incompatible Edge)
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  // Cache-Control obligatoire (K3-I-04)
  const noStoreHeaders = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'GET /api/ouvrier/me' })

  try {
    // Etape 1 — Validation session Redis (D-3-002, pattern D-3-005 etape 1)
    // getOuvrierSession : 5 etapes D-3-002 (get + expire sliding window + parse + validate)
    const session = await getOuvrierSession(request)
    if (!session) {
      return NextResponse.json(
        { error: 'Session expirée. Reconnectez-vous.' },
        { status: 401, headers: noStoreHeaders },
      )
    }

    // Etape 2 — Pas de RBAC base secondaire pour /me (ressource = session courante)
    // K3-I-03 : seulement les données de l'utilisateur courant, pas des autres ouvriers

    const adminClient = createAdminClient()

    // Etape 3 — SELECT explicite users (D-3-004 — pas de SELECT *)
    // AUDIT: SELECT explicite — D-3-004
    const { data: userRow, error: userError } = await adminClient
      .from('users')
      .select('id, nom, prenom, organisation_id')
      .eq('id', session.user_id)
      .eq('organisation_id', session.organisation_id) // defense cross-tenant supplementaire
      .is('deleted_at', null)
      .single()

    if (userError || !userRow) {
      reqLogger.warn(
        { userId: session.user_id },
        'GET /me : utilisateur non trouve en base',
      )
      return NextResponse.json(
        { error: 'Utilisateur introuvable.' },
        { status: 404, headers: noStoreHeaders },
      )
    }

    // Etape 4 — Enrichir les affectations avec les noms de chantiers
    // AUDIT: SELECT explicite — D-3-004 (id, chantier_id, nom chantier uniquement)
    const affectationIds = session.affectations.map((a) => a.affectation_id)

    let enrichedAffectations: Array<{
      affectation_id: string
      chantier_id: string
      chantier_nom: string
      vue: string
    }> = []

    if (affectationIds.length > 0) {
      const { data: affRows, error: affError } = await adminClient
        .from('affectations')
        .select(`
          id,
          chantier_id,
          vue,
          chantiers!affectations_chantier_id_fkey ( nom )
        `)
        .in('id', affectationIds)
        .eq('organisation_id', session.organisation_id)
        // FIX 2026-06-02 : affectations en hard delete (CASCADE migration 002), pas de deleted_at column

      if (affError) {
        reqLogger.error(
          { err: affError.message, userId: session.user_id },
          'GET /me : erreur requete affectations',
        )
        return NextResponse.json(
          { error: 'Erreur interne.' },
          { status: 500, headers: noStoreHeaders },
        )
      }

      type AffRow = {
        id: string
        chantier_id: string
        vue: string
        chantiers: { nom: string } | null
      }

      enrichedAffectations = ((affRows ?? []) as AffRow[]).map((a) => ({
        affectation_id: a.id,
        chantier_id: a.chantier_id,
        chantier_nom: a.chantiers?.nom ?? 'Chantier inconnu',
        vue: a.vue,
      }))
    }

    // Etape 5 — Reponse shape specs §4.3
    const responseBody = {
      user_id: userRow.id,
      nom: userRow.nom,
      prenom: userRow.prenom,
      organisation_id: userRow.organisation_id,
      affectations: enrichedAffectations,
    }

    return NextResponse.json(responseBody, { status: 200, headers: noStoreHeaders })
  } catch (error) {
    reqLogger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'GET /api/ouvrier/me : erreur non geree',
    )
    return NextResponse.json(
      { error: 'Erreur interne.' },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
