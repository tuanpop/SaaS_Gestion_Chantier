// app/api/photos/[id]/route.ts
// PATCH /api/photos/[id] — Modifier commentaire (D-4-003, S4-F01)
// DELETE /api/photos/[id] — Supprimer photo (D-4-002/D-4-009, double-auth, S4-F01)
//
// Auth PATCH : Cookie ouvrier (auteur uploader_id uniquement, D-4-003)
// Auth DELETE : resolvePhotoActor — JWT staff re-valide via getUser() OU cookie ouvrier (D-4-002/D-4-014)
//
// Items securite :
//   D-4-002 : DELETE double chemin — resolvePhotoActor (K4-HI-02 : jamais x-*)
//   D-4-003 : PATCH auteur uniquement (uploader_id = session.user_id)
//   D-4-009 : hard delete + remove Storage best-effort
//   D-4-014 : middleware passe — auth entierement handler-level
//   D-4-015 : runtime = 'nodejs'
//   K4-CR-02 : cross-org DELETE -> 404 (ne revele pas l'existence — K4-MED-06)
//   K4-HI-02 : resolvePhotoActor ne lit JAMAIS les x-headers forgeables
//   K4-HI-04 : 401 sans acteur valide sur chaque methode
//   K4-HI-07 : ouvrier ne peut pas emprunter le chemin staff (pas de JWT)
//   K4-MED-07 : remove Storage KO -> warn + continuer (RG-PHOTO-DELETE-002)
//   K4-MED-10 : Zod .strict() PATCH rejette storage_path, tache_id, etc. -> 400
//   K4-LOW-05 : DELETE retourne 204 No Content

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { resolvePhotoActor, canDeletePhoto } from '@/lib/photos-access'
import { PatchCommentaireSchema } from '@/lib/validation/photos'
import { logger } from '@/lib/logger'

// ============================================================
// PATCH /api/photos/[id] — Modifier commentaire (D-4-003)
// ============================================================
//
// Auth : Cookie ouvrier uniquement. Seul l'auteur (uploader_id = session.user_id) peut modifier.
// Zod .strict() : champs inconnus (storage_path, tache_id, etc.) -> 400 (K4-MED-10 BINDING).
// TST-K4-16 : PATCH { commentaire, storage_path } -> 400.
// TST-K4-17 : PATCH non-auteur -> 403.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: photoId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'PATCH /api/photos/[id]' })

  try {
    // Auth — cookie ouvrier obligatoire (D-4-003 : PATCH = action de l'auteur)
    const session = await getOuvrierSession(request)
    if (!session) {
      return NextResponse.json(
        { error: 'Session expirée. Reconnectez-vous.' },
        { status: 401 },
      )
    }

    // Validation Zod — .strict() rejette tout champ inconnu (K4-MED-10)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Corps de requête JSON invalide.' },
        { status: 400 },
      )
    }

    const parsed = PatchCommentaireSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Données invalides.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const adminClient = createAdminClient()

    // SELECT photo (colonnes explicites — D-3-004)
    // Filtre uploader_id + organisation_id : defense en profondeur (D-4-016)
    const { data: photo, error: selectError } = await adminClient
      .from('photos')
      .select('id, uploader_id, organisation_id, commentaire')
      .eq('id', photoId)
      .eq('organisation_id', session.organisation_id) // isolation org (D-4-016)
      .maybeSingle()

    if (selectError) {
      reqLogger.error({ err: selectError.message, photoId }, 'PATCH photo : erreur SELECT')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    if (!photo) {
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // RBAC : seul l'auteur peut modifier son commentaire (D-4-003)
    if (photo.uploader_id !== session.user_id) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // UPDATE commentaire
    const { data: updated, error: updateError } = await adminClient
      .from('photos')
      .update({ commentaire: parsed.data.commentaire })
      .eq('id', photoId)
      .select('id, commentaire, updated_at')
      .single()

    if (updateError || !updated) {
      reqLogger.error({ err: updateError?.message, photoId }, 'PATCH photo : erreur UPDATE')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    return NextResponse.json({
      id: updated.id,
      commentaire: updated.commentaire,
      updated_at: updated.updated_at,
    }, { status: 200 })
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'PATCH /api/photos/[id] : erreur non geree',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}

// ============================================================
// DELETE /api/photos/[id] — Supprimer photo (D-4-002, double-auth)
// ============================================================
//
// SECURITE CRITIQUE : double chemin d'auth (K4-HI-02, ADR-4-005)
//   Chemin A (ouvrier auteur) : cookie ouvrier_session valide
//   Chemin B (staff) : JWT Supabase re-valide via getUser() — JAMAIS via x-headers
//
// resolvePhotoActor determine le chemin. canDeletePhoto verifie les droits.
//
// SELECT filtre par actor.organisationId : cross-org -> 404 (K4-MED-06, K4-CR-02).
// Storage.remove best-effort : KO -> warn + continuer (K4-MED-07, RG-PHOTO-DELETE-002).
// TST-K4-11 : x-user-role: admin forge SANS JWT valide -> resolvePhotoActor null -> 401.
// TST-K4-12 : cookie + x-user-role forge -> chemin ouvrier (auteur uniquement).
// TST-K4-14 : Storage.remove KO -> 204 + ligne DB supprimee + warn log.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: photoId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'DELETE /api/photos/[id]' })

  try {
    // Etape 1 — Resoudre l'acteur (K4-HI-02 : JWT re-valide via getUser(), jamais x-*)
    // resolvePhotoActor : chemin staff (getUser) d'abord, chemin ouvrier ensuite
    const actor = await resolvePhotoActor(request)
    if (!actor) {
      // K4-HI-04 : 401 sans acteur valide sur chaque methode /api/photos*
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401 },
      )
    }

    const adminClient = createAdminClient()

    // Etape 2 — SELECT photo filtre par actor.organisationId (K4-CR-02, K4-MED-06)
    // Cross-org -> 404 (ne revele pas l'existence d'une photo d'une autre organisation)
    const { data: photo, error: selectError } = await adminClient
      .from('photos')
      .select('id, uploader_id, organisation_id, storage_path')
      .eq('id', photoId)
      .eq('organisation_id', actor.organisationId) // isolation org CRITIQUE
      .maybeSingle()

    if (selectError) {
      reqLogger.error({ err: selectError.message, photoId }, 'DELETE photo : erreur SELECT')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    if (!photo) {
      // Photo inexistante OU cross-org -> 404 (K4-MED-06 : ne pas reveler l'existence)
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // Etape 3 — RBAC : canDeletePhoto (D-4-002)
    // Staff : meme org. Ouvrier : auteur + meme org.
    const allowed = canDeletePhoto(actor, {
      uploader_id: photo.uploader_id,
      organisation_id: photo.organisation_id,
    })
    if (!allowed) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // Etape 4 — DELETE ligne photos EN PREMIER (D-4-009 BINDING)
    // La DB est supprimee AVANT Storage pour eviter l'orphelin DB :
    // si Storage echoue apres DB → fichier orphelin Storage (acceptable, best-effort D-4-009)
    // si DB echoue → rien n'est supprime (atomicite preservee cote referentiel)
    // L'ordre inverse (Storage puis DB) risquait : fichier supprime + ligne DB restante
    // (signed URLs futures invalides, invariant DB rompu).
    const { error: deleteError } = await adminClient
      .from('photos')
      .delete()
      .eq('id', photoId)

    if (deleteError) {
      reqLogger.error({ err: deleteError.message, photoId }, 'DELETE photo : erreur DELETE DB')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // Etape 5 — Supprimer fichier Storage best-effort (D-4-009, K4-MED-07, RG-PHOTO-DELETE-002)
    // Apres DELETE DB reussi — KO Storage -> warn + continuer (fichier orphelin acceptable)
    const { error: storageError } = await adminClient.storage
      .from('photos')
      .remove([photo.storage_path])

    if (storageError) {
      reqLogger.warn(
        { err: storageError.message, photoId },
        'DELETE photo : Storage.remove KO (best-effort — ligne DB deja supprimee)',
      )
    }

    reqLogger.info(
      { photoId, actorKind: actor.kind },
      'Photo supprimee (DELETE double-auth D-4-002)',
    )

    // K4-LOW-05 : 204 No Content
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'DELETE /api/photos/[id] : erreur non geree',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
