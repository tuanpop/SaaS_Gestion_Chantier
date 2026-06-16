-- Migration 015 : table seuils_derives (Sprint 6 — PO-6-02=B seuils configurables par org)
-- Fichier : supabase/migrations/015_seuils_derives.sql
-- Prérequis : migrations 001–014 appliquées (014 DOIT être appliquée AVANT 015).
-- Application : manuelle via Supabase Dashboard SQL editor.
-- Idempotente : IF NOT EXISTS.
-- FIX F002 2026-06-16 : borne inférieure ratio_budget = 0.50 (EXI-Y-K6-07 Kakashi).
-- Sécurité : TST-K6-29/30 (RLS+GRANTs+CHECK) ; EXI-Y-K6-07 (borne 0.50).

-- ============================================================
-- 1. TABLE seuils_derives
-- ============================================================

CREATE TABLE IF NOT EXISTS public.seuils_derives (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid        NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,

  -- Seuil budget : dérive si budget_depense / budget_alloue > ratio_budget
  -- Valeur par défaut : 0.85 (85%)
  -- Bornes valides : 0.50 <= ratio_budget < 1 (borne sécurité EXI-Y-K6-07 — ex: 0.50, 0.70, 0.85, 0.95)
  -- Borne inférieure 0.50 imposée par Kakashi (EXI-Y-K6-07) pour éviter flood notifications /
  -- DoS économique LLM. Un ratio_budget < 0.50 déclencherait des dérives sur quasi tous les
  -- chantiers (TST-K6-25). CHECK SQL = défense profonde (double barrière avec Zod handler).
  ratio_budget        numeric     NOT NULL DEFAULT 0.85
                                  CHECK (ratio_budget >= 0.50 AND ratio_budget < 1),

  -- Seuil blocage : dérive si tâche statut='bloque' depuis > jours_blocage jours
  -- Valeur par défaut : 3
  -- Bornes valides : integer >= 1
  jours_blocage       integer     NOT NULL DEFAULT 3
                                  CHECK (jours_blocage >= 1),

  -- Seuil inactivité : dérive si aucune activité chantier depuis > jours_inactivite jours
  -- Valeur par défaut : 7
  -- Bornes valides : integer >= 1
  jours_inactivite    integer     NOT NULL DEFAULT 7
                                  CHECK (jours_inactivite >= 1),

  -- Pas de seuil pour retard_date_fin : tout dépassement de date_fin_prevue est une dérive.

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.seuils_derives IS
  'Seuils de détection des dérives proactives, configurables par organisation (Sprint 6 PO-6-02=B). 1 ligne par org (UNIQUE sur organisation_id). Le cron lit ces seuils via adminClient et applique le fallback défaut si aucune ligne n existe pour l org. Seuls les admins peuvent modifier leurs seuils. Reset = DELETE la ligne (le cron retombe sur les défauts).';

COMMENT ON COLUMN public.seuils_derives.ratio_budget IS
  'Ratio budget_depense/budget_alloue à partir duquel une dérive est détectée. Ex: 0.85 = alerte si dépenses > 85% du budget. Bornes : 0.50 <= ratio_budget < 1 (borne sécurité EXI-Y-K6-07 — anti-DoS économique LLM). Défaut : 0.85.';

COMMENT ON COLUMN public.seuils_derives.jours_blocage IS
  'Nombre de jours à partir duquel une tâche en statut bloque est considérée en dérive. Basé sur taches.updated_at comme proxy. Défaut : 3. Minimum : 1.';

COMMENT ON COLUMN public.seuils_derives.jours_inactivite IS
  'Nombre de jours sans activité (tâche modifiée ou photo uploadée) à partir duquel un chantier actif est considéré en dérive inactivité. Défaut : 7. Minimum : 1.';

-- ============================================================
-- 2. INDEX
-- Note : l'index UNIQUE sur organisation_id est déjà créé par la contrainte UNIQUE.
-- Lookup O(1) pour le cron (chargerSeuils par orgId).
-- ============================================================

-- L'index UNIQUE implicite suffit pour le lookup par organisation_id.

-- ============================================================
-- 3. RLS — isolation multi-tenant (D-028 BINDING)
-- TST-K6-29 : écriture PostgREST direct bloquée (WITH CHECK(false) / USING(false))
-- TST-K6-16/19 : lecture restreinte aux admins de la même org
-- ============================================================

ALTER TABLE public.seuils_derives ENABLE ROW LEVEL SECURITY;

-- Lecture : admin de la même organisation uniquement (RG-SEUILS-002)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'seuils_derives' AND policyname = 'seuils_derives_select_admin_own_org'
  ) THEN
    CREATE POLICY "seuils_derives_select_admin_own_org"
      ON public.seuils_derives
      FOR SELECT
      USING (
        organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
        AND ((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin'
      );
  END IF;
END $$;

-- Insertion : service_role uniquement (handler API admin utilise adminClient)
-- WITH CHECK(false) = PostgREST direct bloqué (TST-K6-29)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'seuils_derives' AND policyname = 'seuils_derives_insert_service_role_only'
  ) THEN
    CREATE POLICY "seuils_derives_insert_service_role_only"
      ON public.seuils_derives
      FOR INSERT
      WITH CHECK (false);
  END IF;
END $$;

-- Mise à jour : service_role uniquement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'seuils_derives' AND policyname = 'seuils_derives_update_service_role_only'
  ) THEN
    CREATE POLICY "seuils_derives_update_service_role_only"
      ON public.seuils_derives
      FOR UPDATE
      WITH CHECK (false);
  END IF;
END $$;

-- Suppression (reset) : service_role uniquement
-- USING(false) = PostgREST direct DELETE bloqué (TST-K6-29)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'seuils_derives' AND policyname = 'seuils_derives_delete_service_role_only'
  ) THEN
    CREATE POLICY "seuils_derives_delete_service_role_only"
      ON public.seuils_derives
      FOR DELETE
      USING (false);
  END IF;
END $$;

-- ============================================================
-- 4. GRANTs — D-029 BINDING
-- service_role : ALL (UPSERT/DELETE via adminClient handler admin)
-- authenticated : SELECT uniquement (pas INSERT/UPDATE/DELETE)
-- TST-K6-29 : INSERT/UPDATE/DELETE via PostgREST direct bloqués
-- TST-K6-30 : CHECK ratio_budget >= 0.50 enforced au niveau DB
-- ============================================================

GRANT ALL ON public.seuils_derives TO service_role;
GRANT SELECT ON public.seuils_derives TO authenticated;
-- INSERT, UPDATE, DELETE : service_role uniquement (handlers utilisent adminClient)
