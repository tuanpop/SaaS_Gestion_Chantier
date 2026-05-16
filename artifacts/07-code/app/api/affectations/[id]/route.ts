// app/api/affectations/[id]/route.ts
// DELETE /api/affectations/[id] — retirer une affectation (conducteur + admin)
//
// Implémente : specs.md DELETE /api/affectations/[id]
// Items sécurité : T-01 (JWT), T-02 (ownership affectation via organisation_id), D-012
//
// Note TS : adminClient pour les opérations sur affectations (pattern Bug A — Zoro 2026-05-15)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// DELETE /api/affectations/[id]
// ============================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'DELETE /api/affectations/[id]',
  })

  try {
    const { id: affectationId } = await params

    // 1. Claims (T-01)
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Conducteur ou admin uniquement pour supprimer une affectation
    if (role !== 'conducteur' && role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const supabase = await createClient()

    // 3. assertTrialActive — D-012
    await assertTrialActive(supabase, organisationId)

    const adminClient = createAdminClient()

    // 4. Vérifier ownership via organisation_id — T-02
    // Retourner 404 (I-06) plutôt que de laisser la delete silencieusement échouer
    const { data: existing, error: existingError } = await adminClient
      .from('affectations')
      .select('id, organisation_id')
      .eq('id', affectationId)
      .eq('organisation_id', organisationId)
      .single()

    if (existingError || !existing) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    // 5. DELETE physique — une affectation supprimée n'a pas de valeur historique
    // (contrairement à un chantier archivé — D-013 ne s'applique pas ici)
    const { error: deleteError } = await adminClient
      .from('affectations')
      .delete()
      .eq('id', affectationId)
      .eq('organisation_id', organisationId)

    if (deleteError) {
      reqLogger.error(
        { error: deleteError.message, affectationId },
        'Erreur suppression affectation',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    reqLogger.info({ affectationId, userId }, 'Affectation supprimée')

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
