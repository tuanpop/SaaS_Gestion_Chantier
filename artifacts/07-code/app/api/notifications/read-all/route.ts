// app/api/notifications/read-all/route.ts
// POST /api/notifications/read-all — marquer toutes les notifications non lues comme lues
//
// Implémente : US-032 (marquer tout lu), RG-NOTIF-009
// Auth : claims headers middleware
// D-4V-019 : runtime nodejs
// K4V-01 : UPDATE scoppé user_id+org (jamais d'id arbitraire depuis body)
// K4V-05 : claims via middleware uniquement
// Note trial-gate : marquage lu NON bloqué (D-012 / specs §3.1.1)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// POST /api/notifications/read-all
// ============================================================

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'POST /api/notifications/read-all',
  })

  try {
    // 1. Claims via headers middleware (K4V-05)
    const xUserId = request.headers.get('x-user-id')
    const xOrgId = request.headers.get('x-organisation-id')
    const xRole = request.headers.get('x-user-role') as UserRole | null

    if (!xUserId || !xOrgId || !xRole) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Vérifier rôle admin ou conducteur (D-4V-013 : ouvrier exclu)
    if (xRole !== 'admin' && xRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // 3. UPDATE WHERE user_id=:uid AND organisation_id=:org AND lu=false
    // K4V-01 : jamais d'id arbitraire depuis body — scope strict user+org uniquement
    const adminClient = createAdminClient()

    // Pattern Bug A Zoro : cast as unknown pour notifications
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (adminClient as unknown as any)
      .from('notifications')
      .update({ lu: true, read_at: new Date().toISOString() })
      .eq('user_id', xUserId)          // K4V-01 : scope strict user
      .eq('organisation_id', xOrgId)   // K4V-03 : scope strict org
      .eq('lu', false) as { error: { message: string } | null; count: number | null }

    if (error) {
      reqLogger.error({ err: error.message, userId: xUserId }, 'POST /api/notifications/read-all erreur')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    // updated_count : nombre de lignes affectées (0 si tout déjà lu — idempotent RG-NOTIF-009)
    return NextResponse.json({ updated_count: count ?? 0 }, { status: 200 })
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'POST /api/notifications/read-all erreur non gérée',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
