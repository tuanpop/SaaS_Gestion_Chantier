// app/api/ouvrier/chantiers/[id]/route.ts
// GET /api/ouvrier/chantiers/[id] — Vue chantier ouvrier "vue moyenne"
//
// Implemente : US-3.3 (vue taches chantier), US-3.4 (detail tache mienne), US-3.6 (photos lecture seule)
//              RG-VUE-001 a 005, D-3-024 (photos table absente Sprint 3), D-3-025 (troncature API-side)
// Items securite :
//   D-3-004 : SELECT explicite — note_privee_conducteur EXCLUE (K3-CR-02)
//   D-3-005 : pattern 5 etapes RBAC
//   K3-CR-03 : filtre organisation_id CRITIQUE dans RBAC base
//   D-3-024 : try/catch Postgres 42P01 (table photos absente Sprint 3)
//   D-3-025 : troncature description_courte cote API (jamais cote client)

// D-3-010 : Node runtime obligatoire (ioredis incompatible Edge)
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'
import type { GetChantierOuvrierResponse, TacheMienne, TacheAutre, PhotoOuvrier } from '@/types/database'

// Limite photos par tache (D-3-024, D-052/PO-3-02)
const PHOTOS_LIMIT = 50

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
    // Etape 1 — Validation session Redis (D-3-002, pattern D-3-005 etape 1)
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
    // AUDIT: SELECT explicite — D-3-004
    const today = new Date().toISOString().split('T')[0]
    const { data: affectationCheck, error: affError } = await adminClient
      .from('affectations')
      .select('id')
      .eq('user_id', session.user_id)
      .eq('chantier_id', chantierId)
      .eq('organisation_id', session.organisation_id) // K3-CR-03 : filtre organisation_id CRITIQUE
      // FIX 2026-06-02 : affectations en hard delete (CASCADE migration 002), pas de deleted_at column
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
    // AUDIT: SELECT explicite — D-3-004 (note_privee_conducteur exclue)
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
    // AUDIT: SELECT explicite — D-3-004 (note_privee_conducteur EXCLUE INTENTIONNELLEMENT)
    // note_privee_conducteur n'est pas dans cette liste — defense niveau 1/4 (K3-CR-02)
    const { data: tachesRaw, error: tachesError } = await adminClient
      .from('taches')
      .select(
        'id, titre, statut, description, bloque_raison, assigned_to, date_echeance, created_at',
      )
      .eq('chantier_id', chantierId)
      .eq('organisation_id', session.organisation_id)
      // FIX : taches en hard delete (CASCADE migration 002), pas de deleted_at column

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

    // Etape 5 — Query photos pour les taches is_mine=true (D-3-024)
    // Sprint 3 : table photos peut ne pas exister (creee Sprint 4)
    // try/catch sur code Postgres 42P01 (undefined_table)
    const myTacheIds = taches
      .filter((t) => t.assigned_to === session.user_id)
      .map((t) => t.id)

    const photosByTacheId: Record<string, PhotoOuvrier[]> = {}
    const photosTruncatedByTacheId: Record<string, boolean> = {}

    if (myTacheIds.length > 0) {
      try {
        // AUDIT: SELECT explicite — D-3-024 (colonnes whitelistees, pas de SELECT *)
        // Table photos absente du schema TypeScript Sprint 3 (creee Sprint 4)
        // Cast via unknown necessaire : D-3-024 — try/catch sur 42P01 ci-dessous
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const photosClient = adminClient as unknown as { from: (t: string) => any }
        const { data: photosRaw, error: photosError } = await photosClient
          .from('photos')
          .select('id, tache_id, url, created_at')
          .in('tache_id', myTacheIds)
          .order('created_at', { ascending: false }) as { data: unknown[] | null; error: { code?: string; message: string } | null }

        if (photosError) {
          // Verifier si c'est l'erreur 42P01 (table photos absente Sprint 3 — D-3-024)
          const pgCode = (photosError as unknown as { code?: string }).code
          if (pgCode === '42P01') {
            reqLogger.warn(
              { chantierId },
              'Table photos absente (Sprint 3) — photos: [] (D-3-024)',
            )
            // photos restent vides : photosByTacheId = {}
          } else {
            reqLogger.error(
              { err: photosError.message, chantierId },
              'Erreur requete photos',
            )
            // Non-bloquant : continuer sans photos
          }
        } else {
          // Grouper les photos par tache_id avec limite PHOTOS_LIMIT
          type PhotoRaw = { id: string; tache_id: string; url: string; created_at: string }
          const allPhotos = (photosRaw ?? []) as PhotoRaw[]

          for (const tacheId of myTacheIds) {
            const tachePhotos = allPhotos.filter((p) => p.tache_id === tacheId)
            if (tachePhotos.length > PHOTOS_LIMIT) {
              photosByTacheId[tacheId] = tachePhotos.slice(0, PHOTOS_LIMIT).map((p) => ({
                id: p.id,
                url: p.url,
                created_at: p.created_at,
              }))
              photosTruncatedByTacheId[tacheId] = true
            } else {
              photosByTacheId[tacheId] = tachePhotos.map((p) => ({
                id: p.id,
                url: p.url,
                created_at: p.created_at,
              }))
            }
          }
        }
      } catch (photosException) {
        // Catch supplementaire pour les exceptions ioredis/supabase non-standard
        reqLogger.warn(
          { err: photosException instanceof Error ? photosException.message : String(photosException) },
          'Exception requete photos — photos: [] (D-3-024 fallback)',
        )
      }
    }

    // Etape 6 — Projection deux niveaux (architecture §3.4)
    // D-3-008 : TacheMienne et TacheAutre sont STRICTEMENT DISJOINTS
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

      // D-3-025 : troncature cote API pour les descriptions des taches non-siennes
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
          // D-3-025 : description_courte fournie aussi pour la mienne (coherence API)
          description_courte: descriptionCourte,
          bloque_raison: t.bloque_raison,
          date_echeance: t.date_echeance,
          photos_count: (photosByTacheId[t.id] ?? []).length,
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
          // D-3-025 : description_courte max 120 chars pour les taches non-siennes
          description_courte: descriptionCourte,
          // photos_count expose combien de photos existent, mais pas les URLs (K3-HI-05)
          photos_count: 0, // Non-mine : photos non chargees (D-3-024)
        }
        return tacheAutre
      }
    })

    // Etape 7 — Tri final : bloque DESC, is_mine DESC, created_at ASC (RG-VUE-003)
    projectedTaches.sort((a, b) => {
      // Bloque en premier
      if (a.statut === 'bloque' && b.statut !== 'bloque') return -1
      if (a.statut !== 'bloque' && b.statut === 'bloque') return 1
      // Siennes avant les autres
      if (a.is_mine && !b.is_mine) return -1
      if (!a.is_mine && b.is_mine) return 1
      return 0 // created_at ASC : deja dans l'ordre de la requete
    })

    // Etape 8 — SELECT conducteur (RG-VUE-004)
    // AUDIT: SELECT explicite — D-3-004
    const { data: conducteurRow } = await adminClient
      .from('users')
      .select('nom, prenom, telephone')
      .eq('id', chantierRow.created_by)
      .is('deleted_at', null)
      .single()

    const conducteur = conducteurRow ?? { nom: 'Responsable', prenom: '', telephone: null }

    // Etape 9 — Reponse finale GetChantierOuvrierResponse
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
