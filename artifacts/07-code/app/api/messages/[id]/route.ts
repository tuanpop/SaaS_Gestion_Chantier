// app/api/messages/[id]/route.ts
// DELETE /api/messages/[id] — Soft-delete message (modération admin uniquement)
//
// Implements: US-083 (modération admin)
// BINDING : admin UNIQUEMENT — conducteur/ouvrier → 403
// Soft-delete : UPDATE messages SET deleted_at = NOW() (jamais DELETE physique)
// D-8-14 : vérifier que le message appartient bien à un chantier de l'organisation admin
// RLS : messages table WITH CHECK(false) → UPDATE via adminClient uniquement
// PO-8-ADMIN : admin peut modérer n'importe quel message dans son org

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { UserRole } from '@/types/database'

// ============================================================
// DELETE /api/messages/[id]
// ============================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: messageId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'DELETE /api/messages/[id]',
    messageId,
  })

  try {
    // 1. Auth JWT uniquement (admin) — pas de cookie ouvrier
    const xUserId = request.headers.get('x-user-id')
    const xRole = request.headers.get('x-user-role') as UserRole | null
    const xOrgId = request.headers.get('x-organisation-id')

    if (!xUserId || !xRole || !xOrgId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Admin uniquement (US-083)
    if (xRole !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé. Réservé aux administrateurs.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // 3. Vérifier que le message existe et appartient à l'organisation de l'admin
    // D-8-14 : isolation organisation obligatoire
    const { data: msgRow, error: msgError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('messages')
      .select('id, chantier_id, deleted_at')
      .eq('id', messageId)
      .maybeSingle() as unknown as {
        data: {
          id: string
          chantier_id: string
          deleted_at: string | null
        } | null
        error: { message: string } | null
      }

    if (msgError || !msgRow) {
      return NextResponse.json({ error: 'Message introuvable.' }, { status: 404 })
    }

    // Vérifier que le chantier associé appartient bien à l'organisation de l'admin
    const { data: chantierRow, error: chantierError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chantiers')
      .select('id')
      .eq('id', msgRow.chantier_id)
      .eq('organisation_id', xOrgId)
      .maybeSingle() as unknown as {
        data: { id: string } | null
        error: { message: string } | null
      }

    if (chantierError || !chantierRow) {
      // Message dans un chantier hors organisation → 404 (pas de 403 pour éviter la confirmation d'existence)
      return NextResponse.json({ error: 'Message introuvable.' }, { status: 404 })
    }

    // 4. Vérifier que le message n'est pas déjà supprimé
    if (msgRow.deleted_at !== null) {
      return NextResponse.json({ error: 'Message déjà supprimé.' }, { status: 409 })
    }

    // 5. Soft-delete : UPDATE deleted_at = NOW()
    const { error: updateError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId) as unknown as { error: { message: string } | null }

    if (updateError) {
      reqLogger.error({ error: updateError.message }, 'DELETE message: erreur UPDATE')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    reqLogger.info({ messageId, adminId: xUserId }, 'DELETE message: soft-delete OK')
    return NextResponse.json({ deleted: true }, { status: 200 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'DELETE message: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
