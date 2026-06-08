// app/api/notifications/[id]/read/route.ts
// PATCH /api/notifications/[id]/read — marquer 1 notification comme lue
//
// Implémente : US-032 (marquer lu), RG-NOTIF-008/011, K4V-01 (IDOR guard)
// Auth : claims headers middleware
// D-4V-019 : runtime nodejs
// K4V-01 (CRITICAL) : SELECT puis 404 si hors org, 403 si user_id mismatch (IDOR), AVANT UPDATE
// K4V-05 : claims via middleware uniquement, jamais body
// Note trial-gate : marquage lu NON bloqué (D-012 / specs §3.1.1)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { PatchReadSchema } from '@/lib/validation/notifications'
import type { UserRole } from '@/types/database'

// ============================================================
// PATCH /api/notifications/[id]/read
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({
    correlationId,
    route: 'PATCH /api/notifications/[id]/read',
  })

  try {
    const { id: notifId } = await params

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

    // 3. Valider UUID path param (K4V-01 : Zod UUID → 400 si invalide)
    const parsedId = PatchReadSchema.safeParse({ id: notifId })
    if (!parsedId.success) {
      return NextResponse.json(
        { error: 'Identifiant invalide.', details: parsedId.error.flatten() },
        { status: 400 },
      )
    }

    const adminClient = createAdminClient()

    // 4. SELECT — vérifier existence + appartenance org + IDOR guard (K4V-01 CRITICAL)
    // Pattern Bug A Zoro : cast as unknown pour notifications
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: notif, error: selectError } = await (adminClient as unknown as any)
      .from('notifications')
      .select('id, user_id, organisation_id, lu, read_at')
      .eq('id', parsedId.data.id)
      .single() as {
        data: {
          id: string
          user_id: string
          organisation_id: string
          lu: boolean
          read_at: string | null
        } | null
        error: { message: string; code?: string } | null
      }

    // 5. 404 si introuvable OU organisation_id mismatch (K4V-01 : hors org → 404)
    if (selectError || !notif || notif.organisation_id !== xOrgId) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // 6. 403 si user_id mismatch — IDOR guard (K4V-01 CRITICAL, RG-NOTIF-011)
    if (notif.user_id !== xUserId) {
      reqLogger.warn(
        { notifId: parsedId.data.id, requestingUserId: xUserId, ownerUserId: notif.user_id },
        'PATCH /api/notifications/[id]/read : IDOR — notif appartient à un autre user',
      )
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // 7. Idempotent — si déjà lu, retourner 200 sans UPDATE (RG-NOTIF-008)
    if (notif.lu) {
      return NextResponse.json(
        { id: notif.id, lu: true, read_at: notif.read_at },
        { status: 200 },
      )
    }

    // 8. UPDATE SET lu=true, read_at=NOW() — scoppé id+user_id+org (K4V-01)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (adminClient as unknown as any)
      .from('notifications')
      .update({ lu: true, read_at: new Date().toISOString() })
      .eq('id', parsedId.data.id)
      .eq('user_id', xUserId)          // double sécurité K4V-01
      .eq('organisation_id', xOrgId)   // double sécurité K4V-03
      .select('id, lu, read_at')
      .single() as {
        data: { id: string; lu: boolean; read_at: string | null } | null
        error: { message: string } | null
      }

    if (updateError || !updated) {
      reqLogger.error({ err: updateError?.message, notifId: parsedId.data.id }, 'PATCH read erreur UPDATE')
      return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
    }

    return NextResponse.json(
      { id: updated.id, lu: updated.lu, read_at: updated.read_at },
      { status: 200 },
    )
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'PATCH /api/notifications/[id]/read erreur non gérée',
    )
    return NextResponse.json({ error: 'Une erreur interne est survenue.' }, { status: 500 })
  }
}
