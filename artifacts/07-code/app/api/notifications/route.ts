// app/api/notifications/route.ts
// GET /api/notifications — liste paginée cursor + unread_count
//
// Implémente : US-031 (badge), US-032 (fil d'activité)
// Auth : claims headers middleware (x-user-id, x-organisation-id, x-user-role) — pattern /api/chantiers
// D-4V-009 : cursor-based pagination, limit max 20 enforced server-side
// D-4V-010 : double défense org+user (RLS + filtre applicatif)
// D-4V-019 : runtime nodejs (adminClient incompatible Edge)
// K4V-01 : PAS de POST création (route GET only — POST → 405 implicite Next.js)
// K4V-03 : filtre organisation_id + user_id sur chaque query
// K4V-05 : claims via middleware uniquement, jamais body
// K4V-10 : réponse sans organisation_id/user_id
// Note trial-gate : GET notifications NON bloqué par trial (D-012 / specs §3.1.1)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { GetNotificationsSchema } from '@/lib/validation/notifications'
import type { UserRole, NotificationDisplay, NotificationsListResponse } from '@/types/database'

// ============================================================
// GET /api/notifications
// ============================================================

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/notifications',
  })

  try {
    // 1. Claims via headers middleware (K4V-05 : jamais depuis body/query)
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

    // 3. Valider query params
    const { searchParams } = new URL(request.url)
    const parsed = GetNotificationsSchema.safeParse({
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { cursor, limit } = parsed.data
    const adminClient = createAdminClient()

    // 4. Query 1 — liste des notifications (K4V-03 : filtre double org+user)
    // Pattern Bug A Zoro : adminClient résout 'notifications' comme never — cast as unknown requis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notifTable = (adminClient as unknown as any).from('notifications')
    let notifQuery = notifTable
      .select('id, type, titre, message, chantier_id, tache_id, lu, read_at, created_at')
      .eq('organisation_id', xOrgId)   // K4V-03 : filtre org
      .eq('user_id', xUserId)          // K4V-03 : filtre user
      .order('created_at', { ascending: false })
      .limit(limit)

    // Cursor-based pagination (D-4V-009 : cursor = created_at du dernier item)
    if (cursor) {
      notifQuery = notifQuery.lt('created_at', cursor)
    }

    const { data: notifs, error: notifError } = await notifQuery as {
      data: Array<{
        id: string
        type: string
        titre: string
        message: string
        chantier_id: string | null
        tache_id: string | null
        lu: boolean
        read_at: string | null
        created_at: string
      }> | null
      error: { message: string } | null
    }

    if (notifError) {
      reqLogger.error({ err: notifError.message, userId: xUserId }, 'GET /api/notifications erreur liste')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    // 5. Query 2 — COUNT non lus (K4V-03 : filtre double org+user)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error: countError } = await (adminClient as unknown as any)
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', xOrgId)
      .eq('user_id', xUserId)
      .eq('lu', false) as { count: number | null; error: { message: string } | null }

    if (countError) {
      reqLogger.error({ err: countError.message, userId: xUserId }, 'GET /api/notifications erreur count')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    const items = (notifs ?? []) as unknown as NotificationDisplay[]

    // 6. Calculer next_cursor (ISO string du created_at du dernier item, null si fin)
    const nextCursor: string | null =
      items.length === limit ? (items[items.length - 1]?.created_at ?? null) : null

    // 7. Réponse — K4V-10 : SANS organisation_id ni user_id
    const response: NotificationsListResponse = {
      notifications: items,
      unread_count: count ?? 0,
      next_cursor: nextCursor,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'GET /api/notifications erreur non gérée',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
