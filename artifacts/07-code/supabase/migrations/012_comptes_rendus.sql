-- Migration 012 : comptes rendus journaliers Sprint 5 Reporting
-- Fichier : supabase/migrations/012_comptes_rendus.sql
-- Application : manuelle via Supabase Dashboard SQL editor (cohérent 005-011).
-- Idempotente : IF NOT EXISTS.
-- Prérequis : migrations 001–011 appliquées.
-- Note PO-5-04 : cette migration ne contient PAS d'ALTER TABLE sur chantiers.
--   Aucun champ contact_email n'est ajouté. L'envoi externe client est reporté V2.

-- ============================================================
-- 1. TYPE ENUM statut_cr
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.statut_cr AS ENUM (
    'brouillon',  -- Généré par LLM, non validé. Éditable.
    'valide',     -- Approuvé par le conducteur. Non rétrogradable (PO-5-05 A).
    'envoye'      -- Envoyé par email Resend aux destinataires internes. Terminal.
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. TABLE comptes_rendus
-- ============================================================

CREATE TABLE IF NOT EXISTS public.comptes_rendus (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid           NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id      uuid           NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,

  -- Identifiant métier : un seul CR par chantier par jour calendaire (PO-5-01 A)
  date_cr          date           NOT NULL,

  -- Snapshot des signaux terrain au moment de la génération (D-008 : déterministe)
  -- Structure JSON : voir §2.4 SignauxTerrain
  donnees_brutes   jsonb          NULL,

  -- Contenu rédigé par le LLM
  contenu_genere   text           NULL,

  -- Workflow (D-007 BINDING)
  statut           public.statut_cr NOT NULL DEFAULT 'brouillon',

  -- Qui a validé et quand
  valide_par       uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
  valide_at        timestamptz    NULL,

  -- Qui a envoyé et quand
  -- envoye_a : snapshot des destinataires internes au moment de l'envoi (emails séparés par virgule)
  -- PO-5-04 BINDING : destinataires = admins + conducteurs de l'org. Jamais un email externe.
  envoye_par       uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
  envoye_at        timestamptz    NULL,
  envoye_a         text           NULL,  -- snapshot destinataires internes au moment de l'envoi

  -- Source de déclenchement
  declenche_par    text           NOT NULL DEFAULT 'cron'
                                  CHECK (declenche_par IN ('cron', 'manuel')),

  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now()
);

-- Contrainte d'unicité : 1 CR par chantier par jour (idempotence PO-5-01 A)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cr_chantier_date
  ON public.comptes_rendus(chantier_id, date_cr);

COMMENT ON TABLE public.comptes_rendus IS
  'Comptes rendus journaliers Sprint 5. 1 CR par chantier par jour (UNIQUE chantier_id+date_cr). Workflow brouillon→valide→envoye (D-007 BINDING). Isolation multi-tenant via organisation_id (RLS D-028). Envoi interne uniquement (PO-5-04).';

COMMENT ON COLUMN public.comptes_rendus.donnees_brutes IS
  'Snapshot JSON des signaux terrain au moment de la génération. Structure : { taches: [...], photos: [...], budget: { alloue, depense, ecart } }. Jamais mis à jour après génération.';

COMMENT ON COLUMN public.comptes_rendus.contenu_genere IS
  'Texte rédigé par le LLM Claude (modèle défini par @yuki). Peut être modifié par le conducteur en statut brouillon.';

COMMENT ON COLUMN public.comptes_rendus.envoye_a IS
  'Snapshot des emails destinataires internes (admins + conducteurs org) au moment de l envoi. Séparés par virgule. PO-5-04 : jamais un email client externe en V1.';

-- ============================================================
-- 3. INDEX
-- ============================================================

-- Lookup principal : liste CRs d'un chantier
CREATE INDEX IF NOT EXISTS idx_cr_chantier_date
  ON public.comptes_rendus(chantier_id, date_cr DESC);

-- Lookup par organisation (admin : tous les CRs de l'org)
CREATE INDEX IF NOT EXISTS idx_cr_org_date
  ON public.comptes_rendus(organisation_id, date_cr DESC);

-- Lookup statut (filtrer les brouillons en attente de validation)
CREATE INDEX IF NOT EXISTS idx_cr_statut
  ON public.comptes_rendus(organisation_id, statut)
  WHERE statut != 'envoye';

-- ============================================================
-- 4. RLS — isolation multi-tenant (D-028 BINDING)
-- ============================================================

ALTER TABLE public.comptes_rendus ENABLE ROW LEVEL SECURITY;

-- Lecture : admin et conducteur de la même organisation
CREATE POLICY "cr_select_own_org"
  ON public.comptes_rendus
  FOR SELECT
  USING (
    organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
  );

-- Insertion : service_role uniquement (génération par le cron ou le handler serveur)
CREATE POLICY "cr_insert_service_role_only"
  ON public.comptes_rendus
  FOR INSERT
  WITH CHECK (false);

-- Mise à jour : service_role uniquement (validation, édition brouillon, envoi)
-- Le contrôle rôle est applicatif (handler-level)
CREATE POLICY "cr_update_service_role_only"
  ON public.comptes_rendus
  FOR UPDATE
  WITH CHECK (false);

-- Suppression : interdite aux utilisateurs (pas de delete manuel)
-- Cascade automatique si chantier supprimé (ON DELETE CASCADE)

-- ============================================================
-- 5. GRANTs (D-029 : "Automatically expose new tables" = OFF)
-- ============================================================

GRANT ALL ON public.comptes_rendus TO service_role;
GRANT SELECT ON public.comptes_rendus TO authenticated;
-- INSERT, UPDATE, DELETE : service_role uniquement
