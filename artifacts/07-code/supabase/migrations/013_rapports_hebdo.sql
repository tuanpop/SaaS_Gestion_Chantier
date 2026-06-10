-- Migration 013 : rapports hebdomadaires Sprint 5 Reporting
-- Fichier : supabase/migrations/013_rapports_hebdo.sql
-- Prérequis : migration 012 appliquée.
-- Application : manuelle via Supabase Dashboard SQL editor.
-- Idempotente : IF NOT EXISTS.

-- ============================================================
-- 1. TYPE ENUM statut_rapport_hebdo
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.statut_rapport_hebdo AS ENUM (
    'brouillon',  -- Généré par agrégation des CRs. Éditable.
    'valide',     -- Approuvé par le conducteur.
    'envoye'      -- Envoyé par email Resend aux destinataires internes. Terminal.
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. TABLE rapports_hebdo
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rapports_hebdo (
  id               uuid                         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid                         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id      uuid                         NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,

  -- Semaine ISO : année + numéro de semaine (ex: 2026-W24)
  -- 1 rapport par chantier par semaine ISO
  annee_iso        smallint                     NOT NULL CHECK (annee_iso BETWEEN 2020 AND 2100),
  semaine_iso      smallint                     NOT NULL CHECK (semaine_iso BETWEEN 1 AND 53),

  -- CRs source : liste des IDs des comptes_rendus agrégés
  cr_ids           uuid[]                       NOT NULL DEFAULT '{}',

  -- Contenu généré par le LLM
  contenu_genere   text                         NULL,

  -- Workflow (D-007 BINDING — même séquence que CR journalier)
  statut           public.statut_rapport_hebdo  NOT NULL DEFAULT 'brouillon',

  valide_par       uuid                         NULL REFERENCES users(id) ON DELETE SET NULL,
  valide_at        timestamptz                  NULL,

  envoye_par       uuid                         NULL REFERENCES users(id) ON DELETE SET NULL,
  envoye_at        timestamptz                  NULL,
  envoye_a         text                         NULL,  -- snapshot destinataires internes (PO-5-04)

  created_at       timestamptz                  NOT NULL DEFAULT now(),
  updated_at       timestamptz                  NOT NULL DEFAULT now()
);

-- Contrainte d'unicité : 1 rapport par chantier par semaine ISO
CREATE UNIQUE INDEX IF NOT EXISTS uq_rapport_chantier_semaine
  ON public.rapports_hebdo(chantier_id, annee_iso, semaine_iso);

COMMENT ON TABLE public.rapports_hebdo IS
  'Rapports hebdomadaires Sprint 5. Agrège les CRs journaliers d une semaine ISO. Même workflow que comptes_rendus (D-007). 1 rapport par chantier par semaine (UNIQUE chantier_id+annee_iso+semaine_iso). Envoi interne uniquement (PO-5-04).';

-- ============================================================
-- 3. INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_rapports_hebdo_chantier
  ON public.rapports_hebdo(chantier_id, annee_iso DESC, semaine_iso DESC);

CREATE INDEX IF NOT EXISTS idx_rapports_hebdo_org
  ON public.rapports_hebdo(organisation_id, annee_iso DESC, semaine_iso DESC);

-- ============================================================
-- 4. RLS — identique à comptes_rendus
-- ============================================================

ALTER TABLE public.rapports_hebdo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rapport_hebdo_select_own_org"
  ON public.rapports_hebdo
  FOR SELECT
  USING (
    organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
  );

CREATE POLICY "rapport_hebdo_insert_service_role_only"
  ON public.rapports_hebdo
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "rapport_hebdo_update_service_role_only"
  ON public.rapports_hebdo
  FOR UPDATE
  WITH CHECK (false);

-- ============================================================
-- 5. GRANTs (D-029)
-- ============================================================

GRANT ALL ON public.rapports_hebdo TO service_role;
GRANT SELECT ON public.rapports_hebdo TO authenticated;
