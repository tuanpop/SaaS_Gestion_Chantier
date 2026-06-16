// app/api/action-proposals/[id]/valider/route.ts
// PATCH /api/action-proposals/[id]/valider — Valider + exécuter une proposition
//
// Implements: US-075 (validation conducteur), US-076 (exécution admin)
// D-8-13 BINDING : C'EST L'UNIQUE ENDROIT où executerAction est appelé
//   grep executerAction dans pipeline-bot.ts = 0 (S-8-09)
// D-8-14 BINDING IDOR : chantier_id/organisation_id DEPUIS la row action_proposals, JAMAIS du body
// Workflow : pending → execute (via executerAction) ou pending → valide si exécution KO
// RBAC : admin + conducteur UNIQUEMENT (ouvrier → 403)
// Conducteur : uniquement ses chantiers (affecté ou créateur)
// assertTrialActive : obligatoire avant exécution (D-012)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { assertTrialActive } from '@/lib/trial-gate'
import { executerAction } from '@/lib/chat/executerAction'
import {
  insertNotification,
  resolveConducteurChantier,
  resolveAdminsOrg,
} from '@/lib/notifications/notif'
import { logger } from '@/lib/logger'
import type { UserRole, NotificationType } from '@/types/database'
import type { ActionProposal } from '@/types/chat'

// Auth dual-path helper
type AuthResult = {
  userId: string
  role: 'admin' | 'conducteur' | 'ouvrier'
  organisationId: string
} | null

async function resolveAuth(request: NextRequest): Promise<AuthResult> {
  const xUserId = request.headers.get('x-user-id')
  const xRole = request.headers.get('x-user-role') as UserRole | null
  const xOrgId = request.headers.get('x-organisation-id')

  if (xUserId && xRole && xOrgId && (xRole === 'admin' || xRole === 'conducteur')) {
    return { userId: xUserId, role: xRole, organisationId: xOrgId }
  }

  const session = await getOuvrierSession(request)
  if (session) {
    return {
      userId: session.user_id,
      role: 'ouvrier',
      organisationId: session.organisation_id,
    }
  }

  return null
}

// ============================================================
// PATCH /api/action-proposals/[id]/valider
// D-8-13 BINDING : SEUL endroit où executerAction est importé et appelé
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: proposalId } = await params
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({
    correlationId,
    route: 'PATCH /api/action-proposals/[id]/valider',
    proposalId,
  })

  try {
    // 1. Auth
    const auth = await resolveAuth(request)
    if (!auth) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
    }

    // 2. Ouvrier → 403
    if (auth.role === 'ouvrier') {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // 3. Trial-gate (D-012 : avant toute mutation)
    await assertTrialActive(adminClient, auth.organisationId)

    // 4. Récupérer la proposition (D-8-14 : organisation_id depuis la row)
    const { data: proposal, error: proposalError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .select('id, organisation_id, chantier_id, message_id, type, payload, statut, valide_par, valide_at, erreur_execution, ressource_id, ressource_type, created_at')
      .eq('id', proposalId)
      .maybeSingle() as unknown as {
        data: ActionProposal | null
        error: { message: string } | null
      }

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
    }

    // D-8-14 : vérifier que la proposition appartient à l'organisation de l'utilisateur
    if (proposal.organisation_id !== auth.organisationId) {
      return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
    }

    // 5. Vérifier accès conducteur au chantier
    if (auth.role === 'conducteur') {
      const { data: chantierRow } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
        .from('chantiers')
        .select('id, created_by')
        .eq('id', proposal.chantier_id)
        .eq('organisation_id', auth.organisationId)
        .maybeSingle() as unknown as {
          data: { id: string; created_by: string } | null
          error: unknown
        }

      if (!chantierRow) {
        return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
      }

      // Vérifier affectation ou création
      if (chantierRow.created_by !== auth.userId) {
        const today = new Date().toISOString().split('T')[0]
        const { data: aff } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
          .from('affectations')
          .select('id')
          .eq('user_id', auth.userId)
          .eq('chantier_id', proposal.chantier_id)
          .eq('organisation_id', auth.organisationId)
          .or(`date_fin.is.null,date_fin.gte.${today}`)
          .limit(1) as unknown as { data: Array<{ id: string }> | null; error: unknown }

        if (!aff || aff.length === 0) {
          return NextResponse.json({ error: 'Proposition introuvable.' }, { status: 404 })
        }
      }
    }

    // 6. Vérifier statut pending
    if (proposal.statut !== 'pending') {
      return NextResponse.json(
        { error: `Impossible de valider une proposition en statut '${proposal.statut}'.` },
        { status: 409 },
      )
    }

    // 7. Marquer 'valide' d'abord (optimistic — pour que l'UI soit cohérente)
    const valideAt = new Date().toISOString()

    const { error: updateValidError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .update({
        statut: 'valide',
        valide_par: auth.userId,
        valide_at: valideAt,
      })
      .eq('id', proposalId) as unknown as { error: { message: string } | null }

    if (updateValidError) {
      reqLogger.error({ error: updateValidError.message }, 'PATCH valider: erreur UPDATE statut valide')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // 8. Exécuter l'action (D-8-13 BINDING : SEUL appel de executerAction)
    // RG-ACTION-008 : best-effort — échec → erreur_execution logged, statut reste 'valide'
    const resultat = await executerAction(proposal, adminClient)

    // 9. Mettre à jour le résultat d'exécution
    const updatePayload: Record<string, unknown> = {
      statut: 'execute',
    }

    if (resultat.ressource_id) {
      updatePayload['ressource_id'] = resultat.ressource_id
    }
    if (resultat.ressource_type) {
      updatePayload['ressource_type'] = resultat.ressource_type
    }
    if (resultat.erreur) {
      // Exécution échouée : statut reste 'valide' (pas 'execute')
      updatePayload['statut'] = 'valide'
      updatePayload['erreur_execution'] = resultat.erreur.slice(0, 2000)
      reqLogger.error(
        { proposalId, type: proposal.type, erreur: resultat.erreur },
        'PATCH valider: executerAction échoué — statut reste valide',
      )
    } else {
      reqLogger.info(
        { proposalId, type: proposal.type, ressource_id: resultat.ressource_id },
        'PATCH valider: exécution OK → statut execute',
      )
    }

    const { data: finalRow, error: finalError } = await (adminClient as unknown as ReturnType<typeof createAdminClient>)
      .from('action_proposals')
      .update(updatePayload as unknown as import('@/types/database').Database['public']['Tables']['action_proposals']['Update'])
      .eq('id', proposalId)
      .select('id, organisation_id, chantier_id, message_id, type, payload, statut, valide_par, valide_at, erreur_execution, ressource_id, ressource_type, created_at')
      .single() as unknown as {
        data: ActionProposal | null
        error: { message: string } | null
      }

    if (finalError || !finalRow) {
      reqLogger.error({ error: finalError?.message }, 'PATCH valider: erreur UPDATE final')
      // La proposition a été validée + exécutée mais on ne peut pas retourner l'état final
      return NextResponse.json({ error: 'Erreur interne lors de la mise à jour finale.' }, { status: 500 })
    }

    // RG-ACTION-008 / RG-ACTION-010 : notification action_proposal aux conducteurs + admins
    // Best-effort total — ne bloque jamais la réponse 200 (D-4V-002)
    // Notifie que la proposition a été validée et exécutée (ou tentée)
    try {
      const destinataireIds: string[] = []

      // Conducteur(s) du chantier (PO-4V-03 : jamais d'ouvrier)
      const conducteurId = await resolveConducteurChantier(
        adminClient,
        proposal.chantier_id,
        proposal.organisation_id,
      )
      if (conducteurId) {
        destinataireIds.push(conducteurId)
      }

      // Admins de l'organisation
      const adminIds = await resolveAdminsOrg(adminClient, proposal.organisation_id)
      destinataireIds.push(...adminIds)

      const uniqueIds = [...new Set(destinataireIds)]

      const actionTypeLabel: Record<string, string> = {
        creer_tache: 'Créer une tâche',
        ajouter_cr: 'Ajouter au compte-rendu',
        replanifier: 'Replanifier',
        alerte: 'Envoyer une alerte',
      }
      const titreNotif = `Action validée — ${actionTypeLabel[proposal.type] ?? proposal.type}`
      const messageNotif = resultat.erreur
        ? `Exécution en erreur : ${resultat.erreur.slice(0, 200)}`
        : "L'action proposée par Claw a été validée et exécutée."

      for (const userId of uniqueIds) {
        await insertNotification({
          organisationId: proposal.organisation_id,
          userId,
          type: 'action_proposal' as NotificationType,
          titre: titreNotif,
          message: messageNotif,
          chantierId: proposal.chantier_id,
          tacheId: resultat.ressource_type === 'tache' ? resultat.ressource_id : null,
        })
      }

      reqLogger.info(
        { proposalId, destinataireCount: uniqueIds.length },
        'PATCH valider: notification action_proposal envoyée (RG-ACTION-010)',
      )
    } catch (notifErr) {
      // Best-effort — ne jamais bloquer la réponse (D-4V-002)
      reqLogger.warn(
        {
          proposalId,
          error: notifErr instanceof Error ? notifErr.message : String(notifErr),
        },
        'PATCH valider: notification action_proposal KO — non-bloquant',
      )
    }

    return NextResponse.json(finalRow, { status: 200 })
  } catch (err) {
    reqLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'PATCH valider: erreur inattendue',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
