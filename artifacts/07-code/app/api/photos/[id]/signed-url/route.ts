// app/api/photos/[id]/signed-url/route.ts
// GET /api/photos/[id]/signed-url — Rafraichir signed URL expirée (S4-F01, D-4-004)
//
// Auth : Cookie ouvrier_session uniquement (K4-HI-04)
// RBAC : la photo doit appartenir a une tache dont assigned_to = session.user_id (K4-HI-05 IDOR)
//        ET meme organisation (D-4-016)
//
// Items securite :
//   D-4-004 : signed URL TTL 3600s generee serveur via signPhotoPaths (batch)
//   D-4-014 : middleware passe — auth handler-level
//   D-4-015 : runtime = 'nodejs'
//   K4-HI-04 : 401 sans session
//   K4-HI-05 : IDOR signed-url — RBAC via tache assigned_to (pas juste uploader_id)
//   K4-MED-04 : storage_path jamais dans la reponse + signed_url pino redact
//
// Note : l'RBAC est base sur l'acces a LA TACHE (assigned_to), pas seulement l'auteur.
// Un ouvrier peut voir les photos d'une tache qui lui est assignee, meme si il n'en est
// pas l'uploader (coherent US-4.4 : galerie de la tache pour l'assignee).

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { signPhotoPaths } from '@/lib/photos-access'
import { logger } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: photoId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'GET /api/photos/[id]/signed-url' })

  try {
    // Auth — cookie ouvrier obligatoire (K4-HI-04)
    const session = await getOuvrierSession(request)
    if (!session) {
      return NextResponse.json(
        { error: 'Session expirée. Reconnectez-vous.' },
        { status: 401 },
      )
    }

    const adminClient = createAdminClient()

    // RBAC : photo doit etre sur une tache assignee a cet ouvrier (K4-HI-05)
    // JOIN photos -> taches : photos.tache_id = taches.id
    //   AND taches.assigned_to = session.user_id
    //   AND taches.organisation_id = session.organisation_id
    //   AND photos.id = photoId
    // Si photo existe mais tache non assignee -> 403/404 (ne revele pas l'existence cross-org)
    const { data: photoRow, error: selectError } = await adminClient
      .from('photos')
      .select(`
        id,
        storage_path,
        tache_id,
        organisation_id
      `)
      .eq('id', photoId)
      .eq('organisation_id', session.organisation_id)
      .maybeSingle()

    if (selectError) {
      reqLogger.error({ err: selectError.message, photoId }, 'GET signed-url : erreur SELECT photo')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    if (!photoRow) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // Verifier que la tache est assignee a cet ouvrier (K4-HI-05 IDOR signed-url)
    const { data: tacheCheck, error: tacheError } = await adminClient
      .from('taches')
      .select('id')
      .eq('id', photoRow.tache_id)
      .eq('assigned_to', session.user_id)
      .eq('organisation_id', session.organisation_id)
      .maybeSingle()

    if (tacheError) {
      reqLogger.error({ err: tacheError.message, photoId }, 'GET signed-url : erreur SELECT tache')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    if (!tacheCheck) {
      // Tache non assignee a cet ouvrier -> 403 (K4-HI-05)
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // Generer signed URL TTL 3600s (D-4-004 — batch, meme si un seul path)
    // K4-MED-04 : storage_path jamais dans la reponse, signed_url redact par pino
    const signedUrlMap = await signPhotoPaths([photoRow.storage_path])
    const signedUrl = signedUrlMap.get(photoRow.storage_path)

    if (!signedUrl) {
      reqLogger.warn({ photoId }, 'GET signed-url : signed URL non generee')
      return NextResponse.json(
        { error: 'Impossible de générer l\'URL. Réessayez.' },
        { status: 502 },
      )
    }

    // Reponse 200 — storage_path JAMAIS dans la reponse (K4-MED-04, D-4-006)
    return NextResponse.json({
      id: photoRow.id,
      signed_url: signedUrl,
    }, { status: 200 })
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'GET /api/photos/[id]/signed-url : erreur non geree',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
