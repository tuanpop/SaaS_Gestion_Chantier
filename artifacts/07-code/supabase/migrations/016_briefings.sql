-- Migration 016 : table briefings (Sprint 7 IA Briefing automatique lundi matin)
-- Fichier : supabase/migrations/016_briefings.sql
-- Prérequis : migrations 001–015 appliquées.
-- Granularité : 1 briefing par chantier actif par semaine ISO (PO-7-01=A).
-- Pas de workflow de validation (RYO-7-08).
-- Application : manuelle Supabase Dashboard SQL editor.

-- ============================================================
-- 1. TABLE briefings
-- ============================================================

CREATE TABLE IF NOT EXISTS public.briefings (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid           NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id       uuid           NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,

  -- Clé d'idempotence : 1 briefing par chantier par semaine ISO
  annee_iso         integer        NOT NULL CHECK (annee_iso >= 2024),
  semaine_iso       integer        NOT NULL CHECK (semaine_iso BETWEEN 1 AND 53),

  -- Contenu généré par le LLM Sonnet
  -- Null si LLM indisponible ou trial_expired (message_fallback utilisé à la place)
  contenu_genere    text           NULL CHECK (char_length(contenu_genere) <= 8000),

  -- Message fallback si LLM KO ou trial_expired
  message_fallback  text           NULL CHECK (char_length(message_fallback) <= 2000),

  -- Snapshot des signaux au moment de la génération (dérives actives, jalons, état chantier)
  -- Structure JSON : voir types/briefing.ts SignauxBriefingChantier
  -- SECURITE : ne contient JAMAIS note_privee_conducteur (D-051 BINDING)
  donnees_brutes    jsonb          NULL,

  -- Météo : snapshot brut OpenWeather (daily[] 7 jours) pour ce code_postal à ce moment
  -- Null si appel météo KO (best-effort RYO-7-10)
  meteo_snapshot    jsonb          NULL,

  -- Code postal utilisé pour l'appel météo (snapshot depuis chantiers.code_postal)
  code_postal       text           NULL CHECK (code_postal IS NULL OR code_postal ~ '^\d{5}$'),

  -- Statut de génération (audit)
  llm_utilise       boolean        NOT NULL DEFAULT false,
  meteo_disponible  boolean        NOT NULL DEFAULT false,

  -- IDs des notifications créées (pour traçabilité)
  notification_ids  uuid[]         NULL,

  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. CONTRAINTE D'UNICITÉ — idempotence cron-over-cron
-- 1 briefing par chantier par semaine ISO
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_briefing_chantier_semaine
  ON public.briefings(chantier_id, annee_iso, semaine_iso);

COMMENT ON TABLE public.briefings IS
  'Briefings automatiques du lundi matin (Sprint 7). 1 briefing par chantier actif par semaine ISO (UNIQUE chantier_id+annee_iso+semaine_iso). Généré par cron lundi 06h30 UTC. LLM Sonnet synthétise signaux briefing (état chantier + dérives Sprint 6 + jalons semaine + météo OpenWeather). Pas de workflow de validation (RYO-7-08 — distinct du rapport hebdo Sprint 5).';

COMMENT ON COLUMN public.briefings.contenu_genere IS
  'Texte rédigé par claude-sonnet-4-6 (RYO-7-01). Null si LLM KO ou trial_expired. Max 8000 chars.';

COMMENT ON COLUMN public.briefings.meteo_snapshot IS
  'Snapshot brut de la réponse OpenWeather One Call 3.0 (daily[] 7 jours). Null si appel KO (best-effort RYO-7-10).';

COMMENT ON COLUMN public.briefings.donnees_brutes IS
  'Snapshot JSON des signaux briefing au moment de la génération. Structure : { chantier: {...}, derives_actives: [...], jalons_semaine: [...], seuils: {...} }. Permet audit sans requerier les tables sources. SECURITE : note_privee_conducteur jamais présent (D-051 BINDING).';

-- ============================================================
-- 3. INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_briefings_org_created
  ON public.briefings(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_briefings_chantier_created
  ON public.briefings(chantier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_briefings_semaine
  ON public.briefings(annee_iso, semaine_iso);

-- ============================================================
-- 4. RLS — isolation multi-tenant (D-028 BINDING)
-- ============================================================

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

-- Lecture : admin et conducteur de la même organisation
CREATE POLICY "briefings_select_own_org"
  ON public.briefings
  FOR SELECT
  USING (
    organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
  );

-- Insertion : service_role uniquement (cron via adminClient)
-- WITH CHECK(false) = toute écriture depuis authenticated refusée (D-7-10)
CREATE POLICY "briefings_insert_service_role_only"
  ON public.briefings
  FOR INSERT
  WITH CHECK (false);

-- Mise à jour : service_role uniquement (briefings immuables — D-7-09)
CREATE POLICY "briefings_update_service_role_only"
  ON public.briefings
  FOR UPDATE
  WITH CHECK (false);

-- Suppression : pas de policy DELETE (audit trail — D-7-09)
-- Note : l'idempotence est gérée par ON CONFLICT DO NOTHING sur l'index unique

-- ============================================================
-- 5. GRANTs
-- ============================================================

GRANT ALL ON public.briefings TO service_role;
GRANT SELECT ON public.briefings TO authenticated;
-- PAS de GRANT INSERT/UPDATE/DELETE à authenticated (D-029)

-- ============================================================
-- 6. Amendement enum notification_type — ajout 'briefing_lundi'
-- ISOLÉ en fin de migration dans son propre DO $$ (V-7-12 / TST-K7-25)
-- Contrainte PostgreSQL : ADD VALUE ne peut pas être exécuté dans la même transaction
-- que son utilisation. Ce DO $$ distinct garantit l'isolation.
-- JAMAIS insérer de notification briefing_lundi dans cette migration.
-- ============================================================

DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'briefing_lundi';
EXCEPTION
  WHEN others THEN NULL;
END $$;
