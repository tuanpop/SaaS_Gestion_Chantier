// app/api/ouvrier/accueil-claw/route.ts
// GET /api/ouvrier/accueil-claw — Récupère l'accueil Claw du jour pour l'ouvrier
//
// Implements: US-082 (accueil Claw ouvrier)
// BINDING : cookie ouvrier_session UNIQUEMENT (pas de JWT admin/conducteur)
//   Les admins/conducteurs ne peuvent pas appeler cet endpoint
// D-8-16 BINDING : best-effort — aucune erreur ne remonte en 5xx si claw_accueil_log absent
// D-051 BINDING : note_privee_conducteur absent de la réponse (jamais dans claw_accueil_log)
// RG-ACCUEIL-007 : llm_utilise = false si trial fallback (renvoyé dans la réponse)
// RG-ACCUEIL-006 : unicité (user_id, date) via UNIQUE INDEX — on lit la row si elle existe
//
// Flow :
//   1. Session ouvrier (cookie uniquement)
//   2. Lire claw_accueil_log WHERE user_id + date_accueil = today
//   3. Si absent : retourner null (le trigger de génération est le scan QR, pas ce GET)
//   4. Si présent : retourner contenu + meteo_disponible + llm_utilise

// D-3-010 : Node runtime
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'

// ============================================================
// GET /api/ouvrier/accueil-claw
// ============================================================

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'GET /api/ouvrier/accueil-claw',
  })

  try {
    // 1. Session ouvrier uniquement (cookie)
    const session = await getOuvrierSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Session expirée. Reconnectez-vous.' }, { status: 401 })
    }

    const { user_id, organisation_id } = session
    const today = new Date().toISOString().split('T')[0]! // YYYY-MM-DD

    const adminClient = createAdminClient()

    // 2. Lire la row du jour (UNIQUE INDEX user_id + date_accueil)
    // RLS : claw_accueil_log FOR ALL USING(false) → lecture via adminClient
    // D-051 : sélection colonnes explicites, jamais note_privee
    const { data: accueilRow, error: accueilError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('claw_accueil_log')
      .select('id, user_id, chantier_id, date_accueil, contenu, meteo_disponible, llm_utilise, created_at')
      .eq('user_id', user_id)
      .eq('date_accueil', today)
      .maybeSingle() as unknown as {
        data: {
          id: string
          user_id: string
          chantier_id: string
          date_accueil: string
          contenu: string
          meteo_disponible: boolean
          llm_utilise: boolean
          created_at: string
        } | null
        error: { message: string } | null
      }

    if (accueilError) {
      reqLogger.warn(
        { userId: user_id, error: accueilError.message },
        'GET accueil-claw: erreur lecture — retour null (best-effort)',
      )
      // D-8-16 : best-effort — pas de 5xx pour une erreur de lecture accueil
      return NextResponse.json({ accueil: null }, { status: 200 })
    }

    if (!accueilRow) {
      // Pas encore généré pour aujourd'hui (scan QR non encore effectué)
      reqLogger.debug({ userId: user_id, date: today }, 'GET accueil-claw: aucun accueil du jour')
      return NextResponse.json({ accueil: null }, { status: 200 })
    }

    // Vérifier que le chantier appartient à l'organisation de la session (D-8-14)
    // Protection cross-org même si l'accueil est lu en admin
    const { data: chantierRow } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('chantiers')
      .select('id')
      .eq('id', accueilRow.chantier_id)
      .eq('organisation_id', organisation_id)
      .maybeSingle() as unknown as {
        data: { id: string } | null
        error: unknown
      }

    if (!chantierRow) {
      reqLogger.warn(
        { userId: user_id, chantierId: accueilRow.chantier_id },
        'GET accueil-claw: chantier hors organisation — retour null',
      )
      return NextResponse.json({ accueil: null }, { status: 200 })
    }

    reqLogger.debug(
      { userId: user_id, date: today, llm_utilise: accueilRow.llm_utilise },
      'GET accueil-claw: accueil trouvé',
    )

    return NextResponse.json(
      {
        accueil: {
          contenu: accueilRow.contenu,
          meteo_disponible: accueilRow.meteo_disponible,
          llm_utilise: accueilRow.llm_utilise,
          date_accueil: accueilRow.date_accueil,
        },
      },
      { status: 200 },
    )
  } catch (err) {
    // D-8-16 : catch global — retourner null, jamais 5xx
    reqLogger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'GET accueil-claw: erreur inattendue — retour null (best-effort)',
    )
    return NextResponse.json({ accueil: null }, { status: 200 })
  }
}
