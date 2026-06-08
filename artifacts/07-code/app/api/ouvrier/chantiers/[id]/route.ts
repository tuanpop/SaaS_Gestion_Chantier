// app/api/ouvrier/chantiers/[id]/route.ts
// GET /api/ouvrier/chantiers/[id] — Vue chantier ouvrier "vue moyenne"
//
// Implemente : US-3.3 (vue taches chantier), US-3.4 (detail tache mienne), US-3.6 (photos)
//              US-4.4 (photos signed_url dans galerie ouvrier)
//              RG-VUE-001 a 005, D-3-024 -> D-4-007 (breaking change photos[])
//
// Sprint 4 changements (D-4-007) :
//   - Retrait du try/catch 42P01 (table photos desormais creee par migration 008)
//   - Remplacement de url -> signed_url (PhotoOuvrierDisplay)
//   - Remplacement de photos_count par photos: PhotoOuvrierDisplay[] dans TacheMienne
//   - Batch signPhotoPaths (D-4-004 — 1 appel reseau pour N chemins)
//   - Limite 50 photos + photos_truncated si > 50 (RG-PHOTO-007)
//
// Items securite :
//   D-3-004 : SELECT explicite — note_privee_conducteur EXCLUE (K3-CR-02, K4-NPR-01)
//   D-3-005 : pattern 5 etapes RBAC
//   K3-CR-03 : filtre organisation_id CRITIQUE dans RBAC base
//   K4-NPR-01 : note_privee_conducteur ABSENTE + storage_path ABSENT de la reponse finale
//   K4-HI-IDOR : photos taches is_mine=false -> 0 photo (coherent D-3-024)

// D-3-010 : Node runtime obligatoire
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { signPhotoPaths } from '@/lib/photos-access'
import { logger } from '@/lib/logger'
import type {
  GetChantierOuvrierResponse,
  TacheMienne,
  TacheAutre,
  PhotoOuvrierDisplay,
} from '@/types/database'

// Limite photos par tache (D-4-007, RG-PHOTO-007) — 50 max, 51 pour detecter troncature
const PHOTOS_FETCH_LIMIT = 51
const PHOTOS_DISPLAY_LIMIT = 50

// Longueur max description_courte (D-3-025 — troncature cote API)
const DESCRIPTION_COURTE_MAX = 120

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const noStoreHeaders = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

  const { id: chantierId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'GET /api/ouvrier/chantiers/[id]' })

  try {
    // Etape 1 — Validation session (D-3-002, pattern D-3-005 etape 1)
    const session = await getOuvrierSession(request)
    if (!session) {
      return NextResponse.json(
        { error: 'Session expirée. Reconnectez-vous.' },
        { status: 401, headers: noStoreHeaders },
      )
    }

    const adminClient = createAdminClient()

    // Etape 2 — RBAC base : verifier que l'ouvrier est affecte a CE chantier dans CETTE organisation
    // K3-CR-03 CRITIQUE : organisation_id = session.organisation_id (jamais depuis req.body)
    const today = new Date().toISOString().split('T')[0]
    const { data: affectationCheck, error: affError } = await adminClient
      .from('affectations')
      .select('id')
      .eq('user_id', session.user_id)
      .eq('chantier_id', chantierId)
      .eq('organisation_id', session.organisation_id)
      .or(`date_fin.is.null,date_fin.gte.${today}`)
      .limit(1)

    if (affError || !affectationCheck || affectationCheck.length === 0) {
      reqLogger.warn(
        { userId: session.user_id, chantierId, organisationId: session.organisation_id },
        'GET chantier ouvrier : acces refuse (RBAC base affectation)',
      )
      return NextResponse.json(
        { error: 'Accès refusé.' },
        { status: 403, headers: noStoreHeaders },
      )
    }

    // Etape 3 — SELECT chantier (colonnes explicites — D-3-004)
    const { data: chantierRow, error: chantierError } = await adminClient
      .from('chantiers')
      .select('id, nom, client_nom, adresse, code_postal, statut, date_debut, date_fin_prevue, created_by')
      .eq('id', chantierId)
      .eq('organisation_id', session.organisation_id)
      .single()

    if (chantierError || !chantierRow) {
      reqLogger.error(
        { err: chantierError?.message, chantierId },
        'GET chantier ouvrier : chantier non trouve',
      )
      return NextResponse.json(
        { error: 'Chantier introuvable.' },
        { status: 404, headers: noStoreHeaders },
      )
    }

    // Etape 4 — SELECT taches (colonnes explicites SANS note_privee_conducteur — D-3-004, K3-CR-02)
    // AUDIT: SELECT explicite — D-3-004 (note_privee_conducteur EXCLUE INTENTIONNELLEMENT — K4-NPR-01)
    const { data: tachesRaw, error: tachesError } = await adminClient
      .from('taches')
      .select(
        'id, titre, statut, description, bloque_raison, assigned_to, date_echeance, created_at',
      )
      .eq('chantier_id', chantierId)
      .eq('organisation_id', session.organisation_id)

    if (tachesError) {
      reqLogger.error(
        { err: tachesError.message, chantierId },
        'GET chantier ouvrier : erreur requete taches',
      )
      return NextResponse.json(
        { error: 'Erreur interne.' },
        { status: 500, headers: noStoreHeaders },
      )
    }

    const taches = tachesRaw ?? []

    // Etape 5 — Query photos pour les taches is_mine=true (D-4-007, Sprint 4)
    // PLUS de try/catch 42P01 : table photos cree par migration 008 (D-4-007)
    // SELECT explicite — D-3-004 : colonnes whitelistees, jamais SELECT *
    // storage_path inclus INTERNALEMENT pour signPhotoPaths, JAMAIS dans la reponse (K4-NPR-01)
    const myTacheIds = taches
      .filter((t) => t.assigned_to === session.user_id)
      .map((t) => t.id)

    // Map tache_id -> PhotoOuvrierDisplay[] (sans storage_path)
    const photosByTacheId: Record<string, PhotoOuvrierDisplay[]> = {}
    const photosTruncatedByTacheId: Record<string, boolean> = {}

    if (myTacheIds.length > 0) {
      // SELECT photos : lit storage_path pour signPhotoPaths mais JAMAIS expose (K4-NPR-01)
      // AUDIT: SELECT explicite — D-3-004. LIMIT 51 pour detecter la troncature (RG-PHOTO-007)
      const { data: photosRaw, error: photosError } = await adminClient
        .from('photos')
        .select('id, tache_id, storage_path, commentaire, uploader_id, created_at')
        .in('tache_id', myTacheIds)
        .eq('organisation_id', session.organisation_id) // isolation org (D-4-016)
        .order('created_at', { ascending: false })
        .limit(PHOTOS_FETCH_LIMIT * myTacheIds.length) // limite globale = 51 * nb_taches_miennes

      if (photosError) {
        reqLogger.error(
          { err: photosError.message, chantierId },
          'GET chantier ouvrier : erreur requete photos',
        )
        // Non-bloquant : continuer sans photos (defense en profondeur)
      } else {
        const allPhotos = photosRaw ?? []

        // Collecter tous les storage_paths uniques pour le batch signPhotoPaths (D-4-004)
        const storagePaths = [...new Set(allPhotos.map((p) => p.storage_path))]
        const signedUrlMap = storagePaths.length > 0
          ? await signPhotoPaths(storagePaths)
          : new Map<string, string>()

        // Grouper les photos par tache_id avec limite PHOTOS_DISPLAY_LIMIT
        for (const tacheId of myTacheIds) {
          const tachePhotos = allPhotos.filter((p) => p.tache_id === tacheId)

          if (tachePhotos.length > PHOTOS_DISPLAY_LIMIT) {
            photosTruncatedByTacheId[tacheId] = true
          }

          // Mapper vers PhotoOuvrierDisplay — storage_path JAMAIS dans le type de reponse (K4-NPR-01)
          photosByTacheId[tacheId] = tachePhotos
            .slice(0, PHOTOS_DISPLAY_LIMIT)
            .map((p) => ({
              id: p.id,
              commentaire: p.commentaire,
              created_at: p.created_at,
              uploader_id: p.uploader_id,
              signed_url: signedUrlMap.get(p.storage_path) ?? '',
              // storage_path INTENTIONNELLEMENT ABSENT — defense niveau 1 (K4-NPR-01, D-4-006)
            }))
        }
      }
    }

    // Etape 6 — Projection deux niveaux (architecture §3.4)
    // D-3-008 : TacheMienne et TacheAutre STRICTEMENT DISJOINTS
    // D-3-025 : troncature description_courte COTE API (jamais cote client)
    type TacheRow = {
      id: string
      titre: string
      statut: 'a_faire' | 'en_cours' | 'termine' | 'bloque'
      description: string | null
      bloque_raison: string | null
      assigned_to: string | null
      date_echeance: string | null
      created_at: string
    }

    const projectedTaches: Array<TacheMienne | TacheAutre> = (taches as TacheRow[]).map((t) => {
      const isMine = t.assigned_to === session.user_id

      const descriptionCourte = t.description !== null
        ? (t.description ?? '').slice(0, DESCRIPTION_COURTE_MAX)
        : null

      if (isMine) {
        const tacheMienne: TacheMienne = {
          id: t.id,
          titre: t.titre,
          statut: t.statut,
          is_mine: true,
          description_complete: t.description,
          description_courte: descriptionCourte,
          bloque_raison: t.bloque_raison,
          date_echeance: t.date_echeance,
          // D-4-007 BREAKING CHANGE : photos[] remplace photos_count
          photos: photosByTacheId[t.id] ?? [],
          ...(photosTruncatedByTacheId[t.id] ? { photos_truncated: true } : {}),
        }
        return tacheMienne
      } else {
        const tacheAutre: TacheAutre = {
          id: t.id,
          titre: t.titre,
          statut: t.statut,
          is_mine: false,
          description_courte: descriptionCourte,
          // TacheAutre : aucune photo, aucun count (D-4-007, K4-HI-IDOR)
        }
        return tacheAutre
      }
    })

    // Etape 7 — Tri final : bloque DESC, is_mine DESC, created_at ASC (RG-VUE-003)
    projectedTaches.sort((a, b) => {
      if (a.statut === 'bloque' && b.statut !== 'bloque') return -1
      if (a.statut !== 'bloque' && b.statut === 'bloque') return 1
      if (a.is_mine && !b.is_mine) return -1
      if (!a.is_mine && b.is_mine) return 1
      return 0
    })

    // Etape 8 — SELECT conducteur (RG-VUE-004)
    const { data: conducteurRow } = await adminClient
      .from('users')
      .select('nom, prenom, telephone')
      .eq('id', chantierRow.created_by)
      .is('deleted_at', null)
      .single()

    const conducteur = conducteurRow ?? { nom: 'Responsable', prenom: '', telephone: null }

    // Etape 9 — Reponse finale GetChantierOuvrierResponse
    // note_privee_conducteur JAMAIS dans cette reponse (D-3-004, K3-CR-02, K4-NPR-01)
    // storage_path JAMAIS dans cette reponse (D-4-006, K4-NPR-01)
    const responseBody: GetChantierOuvrierResponse = {
      chantier: {
        id: chantierRow.id,
        nom: chantierRow.nom,
        client_nom: chantierRow.client_nom,
        adresse: chantierRow.adresse,
        code_postal: chantierRow.code_postal,
        statut: chantierRow.statut,
        date_debut: chantierRow.date_debut,
        date_fin_prevue: chantierRow.date_fin_prevue,
      },
      taches: projectedTaches,
      conducteur: {
        nom: conducteur.nom,
        prenom: conducteur.prenom,
        telephone: conducteur.telephone,
      },
    }

    return NextResponse.json(responseBody, { status: 200, headers: noStoreHeaders })
  } catch (error) {
    reqLogger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'GET /api/ouvrier/chantiers/[id] : erreur non geree',
    )
    return NextResponse.json(
      { error: 'Erreur interne.' },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
