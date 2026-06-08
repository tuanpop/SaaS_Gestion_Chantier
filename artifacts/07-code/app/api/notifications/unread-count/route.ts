// app/api/notifications/unread-count/route.ts
// GET /api/notifications/unread-count — compteur non-lus pour le badge polling
//
// Implémente : US-031 (badge cloche), D-4V-011 (endpoint léger pour polling 30s)
// Auth : claims headers middleware (x-user-id, x-organisation-id, x-user-role)
// D-4V-019 : runtime nodejs
// K4V-03 : filtre organisation_id + user_id
// K4V-05 : claims via middleware uniquement
// Note trial-gate : GET COUNT non bloqué (D-012 / specs §3.1.1)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// GET /api/notifications/unread-count
// ============================================================

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/notifications/unread-count',
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

    // 3. COUNT seul — query sur index idx_notifications_user_lu_created (D-4V-011)
    const adminClient = createAdminClient()

    // Pattern Bug A Zoro : cast as unknown pour notifications
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (adminClient as unknown as any)
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', xOrgId)   // K4V-03 : filtre org
      .eq('user_id', xUserId)          // K4V-03 : filtre user
      .eq('lu', false) as { count: number | null; error: { message: string } | null }

    if (error) {
      reqLogger.error({ err: error.message, userId: xUserId }, 'GET /api/notifications/unread-count erreur')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    return NextResponse.json({ unread_count: count ?? 0 }, { status: 200 })
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'GET /api/notifications/unread-count erreur non gérée',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
