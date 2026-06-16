-- Migration 014 : table derives_detectees (Sprint 6 IA Dérive)
-- Fichier : supabase/migrations/014_derives_detectees.sql
-- Prérequis : migrations 001–013 appliquées.
-- Application : manuelle via Supabase Dashboard SQL editor.
-- Idempotente : IF NOT EXISTS / DO $$ EXCEPTION duplicate_object.
-- Sécurité : TST-K6-26/27/28 (RLS+GRANTs) ; V-14 (ADD VALUE isolé en fin).

-- ============================================================
-- 1. TYPE ENUM derive_type
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.derive_type AS ENUM (
    'budget_depasse',        -- budget_depense / budget_alloue > seuil org (ou 0.85 défaut)
    'retard_date_fin',       -- date_fin_prevue < today ET chantier actif
    'tache_bloquee_longue',  -- tâche en statut 'bloque' depuis > seuil org (ou 3j défaut)
    'inactivite_chantier'    -- aucune activité depuis > seuil org (ou 7j défaut)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. TABLE derives_detectees
-- ============================================================

CREATE TABLE IF NOT EXISTS public.derives_detectees (
  id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid            NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id      uuid            NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,

  type             public.derive_type NOT NULL,

  -- Référence optionnelle à la tâche concernée (pour derive_type = tache_bloquee_longue)
  -- FK ON DELETE SET NULL : tâche hard-deletée (D-045) → dérive survit, tache_id=null,
  -- résolue au prochain cron (signal disparu).
  tache_id         uuid            NULL REFERENCES taches(id) ON DELETE SET NULL,

  -- Valeur numérique du signal au moment de la détection (ratio budget, nb jours, etc.)
  signal_valeur    numeric         NULL,
  signal_unite     text            NULL CHECK (signal_unite IN ('ratio', 'jours', 'jours_sans_activite')),

  -- Message rédigé par le LLM Haiku à partir des signaux déjà calculés
  -- Null si LLM indisponible (la dérive est quand même enregistrée)
  -- CHECK max 2000 chars (specs §5.1)
  message_llm      text            NULL CHECK (char_length(message_llm) <= 2000),

  detected_at      timestamptz     NOT NULL DEFAULT now(),
  resolved_at      timestamptz     NULL,

  -- ON DELETE SET NULL : dérive survit si notif purgée (90j)
  notification_id  uuid            NULL REFERENCES notifications(id) ON DELETE SET NULL,

  created_at       timestamptz     NOT NULL DEFAULT now(),
  updated_at       timestamptz     NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. CONTRAINTE D'UNICITÉ — idempotence cron-over-cron (D-6-06)
-- Une seule dérive active par (chantier_id, type, tache_id) — resolved_at IS NULL
-- Sentinelle UUID '00000000-...' remplace tache_id NULL dans l'index (D-6-06 / TST-K6-08)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_derive_active_chantier_type_tache
  ON public.derives_detectees(chantier_id, type, COALESCE(tache_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE resolved_at IS NULL;

COMMENT ON TABLE public.derives_detectees IS
  'Dérives proactives détectées par le cron Sprint 6. 1 dérive active par (chantier_id, type, tache_id). Idempotence cron-over-cron via index partiel WHERE resolved_at IS NULL. LLM Haiku rédige le message APRÈS détection déterministe (D-008 BINDING). Seuils lus depuis seuils_derives (PO-6-02=B) avec fallback défaut.';

COMMENT ON COLUMN public.derives_detectees.message_llm IS
  'Message rédigé par le LLM Haiku. PO-6-05=B : 1 appel LLM par chantier, message agrégé pour toutes les dérives du chantier. Null si LLM indisponible — dérive persistée et notifiée avec message fallback.';

COMMENT ON COLUMN public.derives_detectees.resolved_at IS
  'NULL = dérive active. Timestamptz = dérive résolue (signal repassé sous le seuil lors d un passage cron ultérieur, ou chantier archivé). Quand resolved_at est posé, une nouvelle dérive peut être créée si le signal redépasse le seuil.';

COMMENT ON COLUMN public.derives_detectees.tache_id IS
  'Référence optionnelle à la tâche concernée. ON DELETE SET NULL : si la tâche est hard-deletée (D-045), tache_id passe à null. La dérive sera résolue au prochain cron car le signal (tâche bloquée) a disparu.';

-- ============================================================
-- 4. INDEX DE LECTURE (NFR GET p95<300ms)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_derives_chantier_active
  ON public.derives_detectees(chantier_id, type)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_derives_org_active
  ON public.derives_detectees(organisation_id, detected_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_derives_tache
  ON public.derives_detectees(tache_id)
  WHERE tache_id IS NOT NULL;

-- ============================================================
-- 5. RLS — isolation multi-tenant (D-028 BINDING)
-- TST-K6-26 : écriture PostgREST direct bloquée (WITH CHECK(false))
-- TST-K6-27 : lecture cross-org bloquée
-- ============================================================

ALTER TABLE public.derives_detectees ENABLE ROW LEVEL SECURITY;

-- Lecture : admin et conducteur de la même organisation
-- Note : le filtre handler-level (organisation_id = JWT) est une défense profonde supplémentaire
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'derives_detectees' AND policyname = 'derives_select_own_org'
  ) THEN
    CREATE POLICY "derives_select_own_org"
      ON public.derives_detectees
      FOR SELECT
      USING (
        organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
      );
  END IF;
END $$;

-- Insertion : service_role uniquement (cron via adminClient)
-- WITH CHECK(false) = aucun rôle authenticated ne peut insérer via PostgREST (TST-K6-26)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'derives_detectees' AND policyname = 'derives_insert_service_role_only'
  ) THEN
    CREATE POLICY "derives_insert_service_role_only"
      ON public.derives_detectees
      FOR INSERT
      WITH CHECK (false);
  END IF;
END $$;

-- Mise à jour : service_role uniquement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'derives_detectees' AND policyname = 'derives_update_service_role_only'
  ) THEN
    CREATE POLICY "derives_update_service_role_only"
      ON public.derives_detectees
      FOR UPDATE
      WITH CHECK (false);
  END IF;
END $$;

-- Suppression : interdite (les dérives sont résolues, pas supprimées manuellement — D-6-07)
-- Pas de DELETE policy → DELETE toujours bloqué pour les rôles authenticated

-- ============================================================
-- 6. GRANTs — D-029 BINDING
-- service_role : ALL (INSERT/UPDATE via adminClient cron)
-- authenticated : SELECT uniquement (pas INSERT/UPDATE/DELETE)
-- TST-K6-26 : INSERT/UPDATE/DELETE via PostgREST direct bloqués
-- ============================================================

GRANT ALL ON public.derives_detectees TO service_role;
GRANT SELECT ON public.derives_detectees TO authenticated;

-- ============================================================
-- 7. Amendement enum notification_type — ajout 'derive_proactive'
-- V-14 CRITIQUE : ADD VALUE ne peut pas s'exécuter dans la même transaction que son usage.
-- Ce bloc est isolé en FIN de migration, APRÈS tous les CREATE TABLE/INDEX/POLICY/GRANT.
-- TST-K6-28 : vérification que ADD VALUE ne lève pas d'erreur en re-run (IF NOT EXISTS).
-- ============================================================

DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'derive_proactive';
EXCEPTION
  WHEN others THEN NULL;
END $$;
