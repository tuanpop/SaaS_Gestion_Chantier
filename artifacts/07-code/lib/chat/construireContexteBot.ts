// lib/chat/construireContexteBot.ts — Contexte chantier pour le pipeline bot
// EXI-Y-K8-04 BINDING : note_privee_conducteur absent structurellement (D-051)
//   SELECT champ par champ — JAMAIS select('*'), JAMAIS spread (...tache)
// EXI-Y-K8-07 BINDING : contexte borné 1 chantier / 1 org
//   Filtre chantier_id ET organisation_id OBLIGATOIRES sur toute query.
// RG-CLAW-006 : ouvrier → tâches assigned_to seulement, 0 dérives, 0 budget
//   conducteur → dérives actives incluses
// EXI-Y-K8-01 : escapeDelimiter sur chaque champ texte avant injection dans les prompts
//
// Vérifications statiques binding :
//   grep "select('*')" dans ce fichier = 0
//   grep "note_privee" dans ce fichier = 0
//   grep "spread" dans ce fichier = 0

import { escapeDelimiter } from '@/lib/llm/prompt'
import { logger } from '@/lib/logger'
import type { ContexteBot, TacheContexte, MembreContexte, DeriveContexte } from '@/types/chat'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// ============================================================
// construireContexteBot
// Collecte le contexte chantier pour le pipeline bot.
// Tous les champs texte sont passés par escapeDelimiter() avant retour
// pour être prêts à être insérés dans <data>...</data> (EXI-Y-K8-01).
// ============================================================

export async function construireContexteBot(
  chantierId: string,
  organisationId: string,
  roleAppelant: 'admin' | 'conducteur' | 'ouvrier',
  adminClient: AdminClient,
  ouvrierUserId?: string, // requis si roleAppelant === 'ouvrier'
): Promise<ContexteBot | null> {
  try {
    // ── 1. Chantier — colonnes explicites (jamais select('*')) ──────────────
    // EXI-Y-K8-04 : mapping champ par champ, pas de spread
    // EXI-Y-K8-07 : filtre chantier_id + organisation_id OBLIGATOIRES
    const { data: chantierRow, error: chantierError } = await (adminClient as unknown as ReturnType<typeof adminClient.from>['select'] extends never ? never : AdminClient)
      .from('chantiers')
      .select('id, nom, statut, date_debut, date_fin_prevue')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .maybeSingle() as unknown as {
        data: {
          id: string
          nom: string
          statut: string
          date_debut: string | null
          date_fin_prevue: string | null
        } | null
        error: { message: string } | null
      }

    if (chantierError || !chantierRow) {
      logger.warn(
        { chantierId, organisationId, error: chantierError?.message },
        'construireContexteBot: chantier introuvable',
      )
      return null
    }

    // ── 2. Tâches — colonnes explicites (note_privee_conducteur ABSENT) ─────
    // EXI-Y-K8-04 BINDING : sélection explicite — note_privee_conducteur n'est PAS listée
    // D-045 BINDING : taches n'a pas de deleted_at, jamais de filtre deleted_at IS NULL
    // RG-CLAW-006 : ouvrier → filtrées assigned_to = ouvrierUserId ; conducteur → toutes
    let tachesQuery = (adminClient as unknown as AdminClient)
      .from('taches')
      .select('id, titre, statut, date_echeance, assigned_to')
      .eq('chantier_id', chantierId)
      .eq('organisation_id', organisationId) as unknown as {
        eq: (col: string, val: string) => typeof tachesQuery
        neq: (col: string, val: string) => typeof tachesQuery
        data: Array<{
          id: string
          titre: string
          statut: string
          date_echeance: string | null
          assigned_to: string | null
        }> | null
        error: { message: string } | null
      }

    // Filtre ouvrier : uniquement ses tâches affectées (RG-CLAW-006)
    if (roleAppelant === 'ouvrier' && ouvrierUserId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tachesQuery = (tachesQuery as any).eq('assigned_to', ouvrierUserId)
    }

    // Filtre statut : exclure les terminées pour réduire le contexte
    // D-045 : taches.statut = 'termine' (pas 'terminee') — enum TacheStatut
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tachesQuery = (tachesQuery as any).neq('statut', 'termine')

    const { data: tachesRaw, error: tachesError } = await tachesQuery as {
      data: Array<{
        id: string
        titre: string
        statut: string
        date_echeance: string | null
        assigned_to: string | null
      }> | null
      error: { message: string } | null
    }

    if (tachesError) {
      logger.warn(
        { chantierId, organisationId, error: tachesError.message },
        'construireContexteBot: erreur lecture tâches',
      )
    }

    // Mapping champ par champ — JAMAIS spread (...tacheRow) (EXI-Y-K8-04)
    const taches: TacheContexte[] = (tachesRaw ?? []).map((t) => ({
      id: t.id,
      titre: escapeDelimiter(t.titre),           // EXI-Y-K8-01
      statut: t.statut,
      date_echeance: t.date_echeance,
      assigned_to: t.assigned_to,
    }))

    // ── 3. Membres — colonnes explicites ────────────────────────────────────
    // EXI-Y-K8-07 : filtre organisation_id + rattachement chantier
    // Ouvrier : membres non exposés (réduction surface contexte RG-CLAW-006)
    let membres: MembreContexte[] = []

    if (roleAppelant !== 'ouvrier') {
      // Récupérer les membres via affectations du chantier (participants actuels)
      const { data: affectationsRaw, error: affError } = await (adminClient as unknown as AdminClient)
        .from('affectations')
        .select('user_id')
        .eq('chantier_id', chantierId)
        .eq('organisation_id', organisationId) as unknown as {
          data: Array<{ user_id: string }> | null
          error: { message: string } | null
        }

      if (!affError && affectationsRaw && affectationsRaw.length > 0) {
        const userIds = affectationsRaw.map((a) => a.user_id)

        const { data: usersRaw, error: usersError } = await (adminClient as unknown as AdminClient)
          .from('users')
          .select('id, nom, prenom, role')
          .in('id', userIds)
          .eq('organisation_id', organisationId)
          .is('deleted_at', null) as unknown as {
            data: Array<{ id: string; nom: string; prenom: string; role: string }> | null
            error: { message: string } | null
          }

        if (usersError) {
          logger.warn(
            { chantierId, error: usersError.message },
            'construireContexteBot: erreur lecture membres',
          )
        }

        // Mapping champ par champ — JAMAIS spread (EXI-Y-K8-04)
        membres = (usersRaw ?? []).map((u) => ({
          id: u.id,
          nom: escapeDelimiter(u.nom),        // EXI-Y-K8-01
          prenom: escapeDelimiter(u.prenom),  // EXI-Y-K8-01
          role: u.role,
        }))
      }
    }

    // ── 4. Dérives actives — conducteur uniquement (RG-CLAW-006) ───────────
    // Ouvrier : 0 dérives, 0 budget (EXI-Y-K8-07 / RG-CLAW-006)
    // Admin : dérives incluses comme le conducteur
    let derives_actives: DeriveContexte[] = []

    if (roleAppelant === 'conducteur' || roleAppelant === 'admin') {
      const { data: derivesRaw, error: derivesError } = await (adminClient as unknown as AdminClient)
        .from('derives_detectees')
        .select('id, type_derive, description, statut')
        .eq('chantier_id', chantierId)
        .eq('organisation_id', organisationId)
        .eq('statut', 'actif') as unknown as {
          data: Array<{
            id: string
            type_derive: string
            description: string
            statut: string
          }> | null
          error: { message: string } | null
        }

      if (derivesError) {
        logger.warn(
          { chantierId, error: derivesError.message },
          'construireContexteBot: erreur lecture dérives',
        )
      }

      // Mapping champ par champ — JAMAIS spread (EXI-Y-K8-04)
      derives_actives = (derivesRaw ?? []).map((d) => ({
        id: d.id,
        type_derive: d.type_derive,
        description: escapeDelimiter(d.description), // EXI-Y-K8-01
        statut: d.statut,
      }))
    }

    // ── 5. Assemblage contexte final ──────────────────────────────────────
    // escapeDelimiter sur tous les champs texte du chantier (EXI-Y-K8-01)
    const contexte: ContexteBot = {
      chantier: {
        id: chantierRow.id,
        nom: escapeDelimiter(chantierRow.nom),          // EXI-Y-K8-01
        statut: chantierRow.statut,
        date_debut: chantierRow.date_debut,
        date_fin_prevue: chantierRow.date_fin_prevue,
      },
      taches,                // déjà escapés ci-dessus
      membres,               // déjà escapés ci-dessus
      derives_actives,       // déjà escapés ci-dessus
      role_appelant: roleAppelant,
    }

    return contexte
  } catch (err) {
    logger.error(
      {
        chantierId,
        organisationId,
        error: err instanceof Error ? err.message : String(err),
      },
      'construireContexteBot: erreur inattendue',
    )
    return null
  }
}
