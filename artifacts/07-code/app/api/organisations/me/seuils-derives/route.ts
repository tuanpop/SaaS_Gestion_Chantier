// app/api/organisations/me/seuils-derives/route.ts
// GET + PATCH + DELETE /api/organisations/me/seuils-derives
// Admin uniquement. Seuils de détection configurables par organisation (PO-6-02=B).
//
// Sécurité :
//   TST-K6-16/19 : admin only → 403 conducteur/ouvrier.
//   TST-K6-18/23 : organisation_id lu depuis x-organisation-id (JWT headers middleware) —
//     JAMAIS du body (IDOR impossible par body manipulation — EXI-Y-K6-07).
//   TST-K6-17/25 : Zod .strict() + ratio_budget ∈ [0.50, 1) (EXI-Y-K6-07 BINDING).
//   TST-K6-20 : .strict() — tout champ extra → 400 (anti-mass-assignment).
//   TST-K6-21 : PATCH seuils → aucune rétroaction sur dérives actives (D-6-10).
//   TST-K6-23 : DELETE idempotent (200 même si ligne absente).
//   runtime = 'nodejs' : service_role requis (adminClient).
//
// GET : jamais 404 — retourne SEUILS_DEFAUT si aucune ligne (RG-SEUILS-007).
// PATCH : trial-gate (D-012 — write bloqué si trial_expired).
// DELETE : trial-gate (D-012 — write bloqué si trial_expired).
//
// Déviation #1 : cast as unknown as sur seuils_derives.
//   TODO: remove cast after supabase gen types post-mig-015.

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertTrialActive } from '@/lib/trial-gate'
import { PatchSeuilsDerivesSchema } from '@/lib/validation/detection'
import { SEUILS_DEFAUT } from '@/types/detection'
import { logger } from '@/lib/logger'
import type { SeuilsDerivesResponse } from '@/types/detection'
import type { UserRole } from '@/types/database'

// ============================================================
// GET /api/organisations/me/seuils-derives
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'GET /api/organisations/me/seuils-derives' })

  try {
    // 1. Claims depuis headers middleware
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Admin uniquement (TST-K6-16)
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // 3. Chercher la ligne seuils de l'org
    // TST-K6-18 : organisation_id depuis JWT (pas du body)
    // TODO: remove cast after supabase gen types post-mig-015 (déviation #1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as unknown as any)
      .from('seuils_derives')
      .select('ratio_budget, jours_blocage, jours_inactivite, updated_at')
      .eq('organisation_id', organisationId)
      .maybeSingle() as {
        data: {
          ratio_budget: number
          jours_blocage: number
          jours_inactivite: number
          updated_at: string
        } | null
        error: { message: string } | null
      }

    if (error) {
      reqLogger.error({ orgId: organisationId, error: error.message }, 'GET seuils-derives: erreur DB')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // RG-SEUILS-007 : jamais 404 — retourne les défauts si aucune ligne
    const response: SeuilsDerivesResponse = data
      ? {
          organisation_id: organisationId,
          ratio_budget: data.ratio_budget,
          jours_blocage: data.jours_blocage,
          jours_inactivite: data.jours_inactivite,
          source: 'db',
          updated_at: data.updated_at,
        }
      : {
          organisation_id: organisationId,
          ...SEUILS_DEFAUT,
          source: 'defaut',
          updated_at: null,
        }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'GET /api/organisations/me/seuils-derives: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}

// ============================================================
// PATCH /api/organisations/me/seuils-derives
// ============================================================

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'PATCH /api/organisations/me/seuils-derives' })

  try {
    // 1. Claims depuis headers middleware
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Admin uniquement (TST-K6-19)
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // 3. Trial-gate (D-012 — write bloqué si trial_expired)
    const supabase = await createClient()
    await assertTrialActive(supabase, organisationId)

    // 4. Validation Zod (EXI-Y-K6-07 BINDING — TST-K6-17/20/25)
    const body: unknown = await request.json()
    const parsed = PatchSeuilsDerivesSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Requête invalide.',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const adminClient = createAdminClient()

    // 5. Lire les seuils existants pour merger (PATCH partiel)
    // TST-K6-18 BINDING : organisation_id depuis JWT, jamais du body
    // TODO: remove cast after supabase gen types post-mig-015 (déviation #1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: existingError } = await (adminClient as unknown as any)
      .from('seuils_derives')
      .select('ratio_budget, jours_blocage, jours_inactivite')
      .eq('organisation_id', organisationId)
      .maybeSingle() as {
        data: { ratio_budget: number; jours_blocage: number; jours_inactivite: number } | null
        error: { message: string } | null
      }

    if (existingError) {
      reqLogger.error({ orgId: organisationId, error: existingError.message }, 'PATCH seuils-derives: erreur lecture existant')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // Merger : valeurs existantes (ou défauts) + champs fournis dans le PATCH
    const baseValues = existing ?? SEUILS_DEFAUT
    const merged = {
      ratio_budget: parsed.data.ratio_budget ?? baseValues.ratio_budget,
      jours_blocage: parsed.data.jours_blocage ?? baseValues.jours_blocage,
      jours_inactivite: parsed.data.jours_inactivite ?? baseValues.jours_inactivite,
    }

    // 6. UPSERT — ON CONFLICT (organisation_id) DO UPDATE
    // TST-K6-18 BINDING : organisation_id depuis JWT, jamais du body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: upserted, error: upsertError } = await (adminClient as unknown as any)
      .from('seuils_derives')
      .upsert(
        {
          organisation_id: organisationId,
          ...merged,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organisation_id' },
      )
      .select('ratio_budget, jours_blocage, jours_inactivite, updated_at')
      .single() as {
        data: { ratio_budget: number; jours_blocage: number; jours_inactivite: number; updated_at: string } | null
        error: { message: string } | null
      }

    if (upsertError || !upserted) {
      reqLogger.error(
        { orgId: organisationId, error: upsertError?.message },
        'PATCH seuils-derives: erreur upsert',
      )
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // TST-K6-21 : aucune rétroaction sur dérives actives (D-6-10) — l'UI affiche le message info
    reqLogger.info({ orgId: organisationId }, 'PATCH seuils-derives: seuils mis à jour')

    const response: SeuilsDerivesResponse = {
      organisation_id: organisationId,
      ratio_budget: upserted.ratio_budget,
      jours_blocage: upserted.jours_blocage,
      jours_inactivite: upserted.jours_inactivite,
      source: 'db',
      updated_at: upserted.updated_at,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'PATCH /api/organisations/me/seuils-derives: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}

// ============================================================
// DELETE /api/organisations/me/seuils-derives
// ============================================================

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get('x-correlation-id') ?? 'unknown'
  const reqLogger = logger.child({ correlationId, route: 'DELETE /api/organisations/me/seuils-derives' })

  try {
    // 1. Claims depuis headers middleware
    const organisationId = request.headers.get('x-organisation-id')
    const userId = request.headers.get('x-user-id')
    const role = request.headers.get('x-user-role') as UserRole | null

    if (!organisationId || !userId || !role) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Admin uniquement
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // 3. Trial-gate (D-012 — write bloqué si trial_expired)
    const supabase = await createClient()
    await assertTrialActive(supabase, organisationId)

    const adminClient = createAdminClient()

    // 4. DELETE — TST-K6-23 BINDING : organisation_id depuis JWT, jamais du body
    // Idempotent : 200 même si la ligne n'existe pas (RG-SEUILS-005)
    // TODO: remove cast after supabase gen types post-mig-015 (déviation #1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteError } = await (adminClient as unknown as any)
      .from('seuils_derives')
      .delete()
      .eq('organisation_id', organisationId) as { error: { message: string } | null }

    if (deleteError) {
      reqLogger.error(
        { orgId: organisationId, error: deleteError.message },
        'DELETE seuils-derives: erreur DB',
      )
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // TST-K6-23 : idempotent — 200 même si aucune ligne supprimée
    reqLogger.info({ orgId: organisationId }, 'DELETE seuils-derives: reset aux défauts')

    // Retourner les valeurs par défaut (le cron utilisera SEUILS_DEFAUT)
    const response: SeuilsDerivesResponse = {
      organisation_id: organisationId,
      ...SEUILS_DEFAUT,
      source: 'defaut',
      updated_at: null,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'DELETE /api/organisations/me/seuils-derives: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
