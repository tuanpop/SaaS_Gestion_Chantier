// app/api/briefings/[id]/route.ts — Détail d'un briefing (admin + conducteur)
// US-062 : détail complet avec bloc météo (PO Option A — meteo_jours extraits de meteo_snapshot)
// Auth : JWT admin/conducteur — ouvrier → 403
// TST-K7-22 : double filtre org + access chantier → 404 si non trouvé (jamais 403)
// Exclut : donnees_brutes, meteo_snapshot, notification_ids, organisation_id (specs §6.4)
// Inclut : code_postal, meteo_jours?: MeteoJour[] (calculés côté serveur depuis meteo_snapshot)

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { canAccessChantier } from '@/lib/chantier-access'
import { analyserMeteo } from '@/lib/briefing/analyserMeteo'
import type { BriefingDetail, MeteoJour } from '@/types/briefing'

interface Params {
  params: Promise<{ id: string }>
}

// Champs DB sélectionnés — JAMAIS donnees_brutes, notification_ids, organisation_id
// meteo_snapshot est sélectionné UNIQUEMENT pour en extraire les MeteoJour côté serveur
// puis exclu de la réponse (PO Option A)
interface BriefingDetailRow {
  id: string
  chantier_id: string
  organisation_id: string  // nécessaire pour vérif cross-org — non exposé dans réponse
  annee_iso: number
  semaine_iso: number
  contenu_genere: string | null
  message_fallback: string | null
  llm_utilise: boolean
  meteo_disponible: boolean
  code_postal: string | null
  created_at: string
  meteo_snapshot: unknown  // jsonb brut — extrait en MeteoJour, jamais exposé tel quel
  chantiers: { nom: string } | null
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const userId = request.headers.get('x-user-id')
    const organisationId = request.headers.get('x-organisation-id')
    const userRole = request.headers.get('x-user-role')
    const briefingId = (await params).id

    if (!userId || !organisationId) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // Ouvrier → 403
    if (userRole !== 'admin' && userRole !== 'conducteur') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // ── 2. Récupérer le briefing — filtre organisation_id OBLIGATOIRE ────────
    // TST-K7-22 : double filtre org + access chantier → 404 (jamais 403 — I-06)
    // adminClient bypass RLS → filtre handler-level OBLIGATOIRE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: briefingRaw, error: briefingError } = await (adminClient as unknown as any)
      .from('briefings')
      .select('id, chantier_id, organisation_id, annee_iso, semaine_iso, contenu_genere, message_fallback, llm_utilise, meteo_disponible, code_postal, created_at, meteo_snapshot, chantiers!briefings_chantier_id_fkey(nom)')
      // Filtre org OBLIGATOIRE (TST-K7-22)
      .eq('id', briefingId)
      .eq('organisation_id', organisationId)
      .single() as { data: BriefingDetailRow | null; error: { message: string; code?: string } | null }

    if (briefingError) {
      // PGRST116 = no rows returned (Supabase single() error)
      if (briefingError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
      }
      logger.error(
        { briefingId, organisationId, err: briefingError.message },
        'GET /api/briefings/[id]: erreur DB',
      )
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    if (!briefingRaw) {
      // Briefing non trouvé ou cross-org → 404 (I-06 pattern — TST-K7-22)
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // ── 3. Vérification accès au chantier (conducteur : rattaché ?) ──────────
    // TST-K7-22 : double vérif org (faite ci-dessus) + accès chantier (ici)
    const hasAccess = await canAccessChantier(
      adminClient,
      briefingRaw.chantier_id,
      organisationId,
      userId,
      userRole as 'admin' | 'conducteur',
    )

    if (!hasAccess) {
      // 404 (pas 403) — ne révèle pas l'existence (I-06 / TST-K7-22)
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    // ── 4. Extraire meteo_jours depuis meteo_snapshot (PO Option A) ──────────
    // meteo_snapshot = jsonb stocké par le cron (réponse brute OpenWeather)
    // Les MeteoJour sont recalculés côté serveur pour ne JAMAIS exposer le snapshot brut
    let meteoJours: MeteoJour[] | undefined = undefined

    if (briefingRaw.meteo_disponible && briefingRaw.meteo_snapshot !== null) {
      try {
        // code_postal requis pour analyserMeteo — fallback 'inconnu' si absent
        const codePostal = briefingRaw.code_postal ?? 'inconnu'
        const meteoSemaine = analyserMeteo(
          briefingRaw.meteo_snapshot,
          codePostal,
          briefingRaw.created_at,  // fetched_at approx (on n'a pas le champ exact ici)
          'cache',  // données extraites du snapshot stocké
        )
        meteoJours = meteoSemaine.jours
      } catch (meteoErr) {
        // meteo_snapshot corrompu → pas de meteo_jours (best-effort — ne bloque pas)
        logger.warn(
          {
            briefingId,
            err: meteoErr instanceof Error ? meteoErr.message : String(meteoErr),
          },
          'GET /api/briefings/[id]: meteo_snapshot invalide — meteo_jours absents',
        )
        meteoJours = undefined
      }
    }

    // ── 5. Construire la réponse BriefingDetail ───────────────────────────────
    // Exclut : donnees_brutes (non sélectionné), meteo_snapshot (jamais exposé), notification_ids (non sélectionné), organisation_id (non exposé)
    const response: BriefingDetail = {
      id: briefingRaw.id,
      chantier_id: briefingRaw.chantier_id,
      annee_iso: briefingRaw.annee_iso,
      semaine_iso: briefingRaw.semaine_iso,
      contenu_genere: briefingRaw.contenu_genere,
      message_fallback: briefingRaw.message_fallback,
      llm_utilise: briefingRaw.llm_utilise,
      meteo_disponible: briefingRaw.meteo_disponible,
      code_postal: briefingRaw.code_postal,
      created_at: briefingRaw.created_at,
      chantier_nom: briefingRaw.chantiers?.nom ?? 'Chantier inconnu',
      // Option A : meteo_jours inclus si disponibles (undefined = absent de la réponse JSON)
      ...(meteoJours !== undefined && { meteo_jours: meteoJours }),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'GET /api/briefings/[id]: erreur non gérée',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
