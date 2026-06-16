// lib/briefing/collecterSignaux.ts — Collecte déterministe des signaux briefing
// D-008 BINDING : ZÉRO appel LLM. Pure TypeScript + DB.
// D-7-02 : collecte AVANT tout appel LLM — météo injectée.
// D-051 BINDING : note_privee_conducteur jamais sélectionné ni mappé.
// D-045 BINDING : jamais taches.deleted_at IS NULL (colonne inexistante — hard delete).
// Mapping champ par champ — JAMAIS select('*') ni spread ...tache (TST-K7-03).
// Réutilise getIsoWeek/getIsoYear depuis lib/reporting/isoWeek.ts (pas de réécriture).

import type { MeteoSemaine, SignauxBriefingChantier, JalonSemaine, DeriveActive } from '@/types/briefing'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

// ============================================================
// Types DB internes (cast strict — jamais spread)
// ============================================================

interface ChantierRow {
  id: string
  organisation_id: string
  nom: string
  statut: string
  budget_alloue: number | null
  budget_depense: number
  date_fin_prevue: string | null
  code_postal: string
}

interface TacheRow {
  id: string
  titre: string           // SEUL champ titre — JAMAIS note_privee_conducteur (D-051)
  date_echeance: string
  statut: string
  assigned_to: string | null
  // AUDIT: note_privee_conducteur JAMAIS sélectionné ici (D-051 BINDING)
}

interface TacheAvecUser extends TacheRow {
  assigned_user: { nom: string; prenom: string } | null
}

interface DeriveRow {
  id: string
  type: string
  signal_valeur: number | null
  signal_unite: string | null
  message_llm: string | null
  detected_at: string
}

interface SeuilsRow {
  ratio_budget: number
}

// ============================================================
// collecterSignaux — point d'entrée
// Reçoit adminClient + chantierId + meteo (injectée — D-7-02) + annee/semaine ISO
// Retourne SignauxBriefingChantier typé — unique entrée du LLM Sonnet
// ============================================================

/**
 * Collecte de façon déterministe les signaux briefing pour un chantier actif.
 * Aucun appel LLM (D-008 BINDING).
 * La météo est injectée (fetchMeteo appelé avant par le cron — D-7-02).
 *
 * @param adminClient - Client Supabase service_role
 * @param chantierId - UUID du chantier
 * @param meteo - MeteoSemaine pré-fetchée (source='indisponible' si KO)
 * @param anneeIso - Année ISO courante (calculée côté serveur UTC)
 * @param semaineIso - Semaine ISO courante (calculée côté serveur UTC)
 */
export async function collecterSignaux(
  adminClient: ReturnType<typeof createAdminClient>,
  chantierId: string,
  meteo: MeteoSemaine,
  anneeIso: number,
  semaineIso: number,
): Promise<SignauxBriefingChantier> {
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]! // YYYY-MM-DD

  // Fenêtre jalons : [today, today+6 jours]
  const todayPlus6 = new Date(now)
  todayPlus6.setUTCDate(now.getUTCDate() + 6)
  const todayPlus6Str = todayPlus6.toISOString().split('T')[0]!

  // ── 1. Chantier ──────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chantierRaw, error: chantierError } = await (adminClient as unknown as any)
    .from('chantiers')
    .select('id, organisation_id, nom, statut, budget_alloue, budget_depense, date_fin_prevue, code_postal')
    .eq('id', chantierId)
    .single() as { data: ChantierRow | null; error: { message: string } | null }

  if (chantierError || !chantierRaw) {
    throw new Error(`collecterSignaux: chantier introuvable — chantierId=${chantierId}`)
  }

  const chantier = chantierRaw

  // Budget ratio — protégé contre division par zéro (spec §2.4)
  let budgetRatio: number | null = null
  if (chantier.budget_alloue !== null && chantier.budget_alloue > 0) {
    budgetRatio = chantier.budget_depense / chantier.budget_alloue
  }

  // Jours restants avant fin prévue
  let joursRestantsFin: number | null = null
  if (chantier.date_fin_prevue) {
    const dateFin = new Date(chantier.date_fin_prevue)
    const diffMs = dateFin.getTime() - now.getTime()
    joursRestantsFin = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  }

  // ── 2. Dérives actives Sprint 6 ──────────────────────────────────────────────
  // Réutilise derives_detectees WHERE resolved_at IS NULL (ne recalcule JAMAIS — D-7-02)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: derivesRaw, error: derivesError } = await (adminClient as unknown as any)
    .from('derives_detectees')
    .select('id, type, signal_valeur, signal_unite, message_llm, detected_at')
    .eq('chantier_id', chantierId)
    .is('resolved_at', null)
    .order('detected_at', { ascending: false }) as { data: DeriveRow[] | null; error: { message: string } | null }

  if (derivesError) {
    logger.warn(
      { chantierId, err: derivesError.message },
      'collecterSignaux: erreur lecture derives_detectees (best-effort)',
    )
  }

  const derivesActives: DeriveActive[] = (derivesRaw ?? []).map((d): DeriveActive => ({
    type: d.type as DeriveActive['type'],
    signal_valeur: d.signal_valeur,
    signal_unite: d.signal_unite,
    message_llm: d.message_llm,
    detected_at: d.detected_at,
  }))

  // ── 3. Jalons semaine ─────────────────────────────────────────────────────────
  // D-051 BINDING : sélection EXPLICITE des champs — JAMAIS select('*') ni spread
  // D-045 BINDING : JAMAIS taches.deleted_at IS NULL (colonne inexistante — hard delete)
  // AUDIT: grep note_privee_conducteur dans ce fichier = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tachesRaw, error: tachesError } = await (adminClient as unknown as any)
    .from('taches')
    .select(`
      id,
      titre,
      date_echeance,
      statut,
      assigned_to,
      assigned_user:users!taches_assigned_to_fkey (nom, prenom)
    `)
    .eq('chantier_id', chantierId)
    .not('date_echeance', 'is', null)
    .gte('date_echeance', todayStr)
    .lte('date_echeance', todayPlus6Str)
    .order('date_echeance', { ascending: true }) as { data: TacheAvecUser[] | null; error: { message: string } | null }

  if (tachesError) {
    logger.warn(
      { chantierId, err: tachesError.message },
      'collecterSignaux: erreur lecture taches jalons (best-effort)',
    )
  }

  const jalonsSemaine: JalonSemaine[] = (tachesRaw ?? []).map((t): JalonSemaine => {
    // Calcul jours restants (peut être négatif si tâche en retard)
    const dateEcheance = new Date(t.date_echeance)
    const diffMs = dateEcheance.getTime() - now.getTime()
    const joursRestants = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    // assigned_to_nom — mapping strict champ par champ (D-051)
    // JAMAIS : ...t (spread) ou t.note_privee_conducteur
    const assignedUser = t.assigned_user as { nom: string; prenom: string } | null
    const assignedToNom = assignedUser
      ? `${assignedUser.prenom} ${assignedUser.nom}`.trim()
      : null

    return {
      tache_id: t.id,
      tache_titre: t.titre.substring(0, 200), // max 200 chars (specs §2.4)
      date_echeance: t.date_echeance,
      statut: t.statut,
      jours_restants: joursRestants,
      assigned_to_nom: assignedToNom,
      // SECURITE : note_privee_conducteur ABSENT (D-051) — TypeScript l'interdit structurellement
    }
  })

  // ── 4. Seuils de l'organisation ──────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: seuilsRaw } = await (adminClient as unknown as any)
    .from('seuils_derives')
    .select('ratio_budget')
    .eq('organisation_id', chantier.organisation_id)
    .maybeSingle() as { data: SeuilsRow | null; error: unknown }

  // Défaut seuil 0.9 si non configuré (RG-BRIEFING-006 contexte LLM)
  const seuilBudget = seuilsRaw?.ratio_budget ?? 0.9

  // ── 5. Assembler SignauxBriefingChantier ──────────────────────────────────────
  const signaux: SignauxBriefingChantier = {
    chantier_id: chantier.id,
    chantier_nom: chantier.nom.substring(0, 100), // max 100 chars (specs §2.4)
    organisation_id: chantier.organisation_id,
    semaine_iso: semaineIso,
    annee_iso: anneeIso,
    generated_at: now.toISOString(),
    statut: chantier.statut,
    budget_ratio: budgetRatio,
    jours_restants_fin: joursRestantsFin,
    derives_actives: derivesActives,
    jalons_semaine: jalonsSemaine,
    meteo,
    seuil_budget: seuilBudget,
  }

  logger.debug(
    {
      chantierId,
      nbDerives: derivesActives.length,
      nbJalons: jalonsSemaine.length,
      meteoSource: meteo.source,
    },
    'collecterSignaux: signaux assemblés',
  )

  return signaux
}
