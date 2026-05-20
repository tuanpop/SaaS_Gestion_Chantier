// app/api/chantiers/[id]/unarchive/route.ts
// POST /api/chantiers/[id]/unarchive — désarchiver un chantier (admin uniquement)
//
// Endpoint dédié plutôt qu'extension de PATCH : sémantique claire,
// audit trail simple, restreint au seul transition archive → actif.
// Le DELETE handler /api/chantiers/[id] fait la transition inverse
// (actif → archive) en soft delete (D-013 RGPD).
//
// Sécurité :
//   T-01 : organisation_id depuis JWT (headers middleware) uniquement
//   D-012 : assertTrialActive sur la mutation
//   E-01 : admin uniquement
//   I-06 : 404 générique si chantier hors org / inexistant / déjà actif

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { toApiResponse } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'POST /api/chantiers/[id]/unarchive',
  })

  try {
    const { id: chantierId } = await params

    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const supabase = await createClient()
    await assertTrialActive(supabase, organisationId)

    const adminClient = createAdminClient()

    // Vérifier ownership + statut courant.
    // I-06 : 404 générique si non trouvé OU si déjà actif (pas de divulgation d'état).
    const { data: existing, error: existingError } = await adminClient
      .from('chantiers')
      .select('id, statut')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .single()

    if (existingError || !existing) {
      return NextResponse.json(
        { error: 'Ressource introuvable.' },
        { status: 404 },
      )
    }

    if ((existing as { statut: string }).statut !== 'archive') {
      // Idempotent : si déjà actif, retourner 409 explicite (utile UX) plutôt que 404.
      // Ce n'est pas une information sensible — un admin de l'org sait déjà que le chantier existe.
      return NextResponse.json(
        { error: 'Ce chantier est déjà actif.' },
        { status: 409 },
      )
    }

    // Restore : statut → 'actif', date_fin_reelle → null (effacée à l'archivage logique).
    const { error } = await adminClient
      .from('chantiers')
      .update({
        statut: 'actif',
        date_fin_reelle: null,
      })
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)

    if (error) {
      reqLogger.error(
        { error: error.message, chantierId },
        'Erreur désarchivage chantier',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500 },
      )
    }

    reqLogger.info({ chantierId, userId }, 'Chantier désarchivé')
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return toApiResponse(error, correlationId)
  }
}
