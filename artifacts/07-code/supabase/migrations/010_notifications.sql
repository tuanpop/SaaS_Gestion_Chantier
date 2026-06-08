-- Migration 010 : système de notifications in-app (Sprint 4 Visibilité)
-- Fichier : supabase/migrations/010_notifications.sql
-- Application : manuelle via Supabase Dashboard SQL editor (cohérent 005-009).
-- Idempotente : IF NOT EXISTS.
-- Prérequis : migrations 001–009 appliquées.

-- ============================================================
-- 1. TYPE ENUM notification_type
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'affectation_tache',    -- Événement 1 (PO-4V-01) : tâche assignée à un user
    'tache_terminee',       -- Événement 2a : tâche passée à statut 'termine'
    'tache_bloquee',        -- Événement 2b : tâche passée à statut 'bloque'
    'derive_budget',        -- Événement 3 : chantier bascule vers orange/rouge sur axe budget
    'echeance_chantier',    -- Événement 4a (cron) : date_fin_prevue chantier dépassée
    'echeance_tache'        -- Événement 4b (cron) : date_echeance tâche dépassée
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. TABLE notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid                      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         uuid                      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            public.notification_type  NOT NULL,
  titre           text                      NOT NULL CHECK (char_length(titre) BETWEEN 1 AND 200),
  message         text                      NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  -- Payload de référence : au moins l'un des deux est non-null selon le type
  chantier_id     uuid                      NULL REFERENCES chantiers(id) ON DELETE SET NULL,
  tache_id        uuid                      NULL REFERENCES taches(id) ON DELETE SET NULL,
  -- État lecture
  lu              boolean                   NOT NULL DEFAULT false,
  read_at         timestamptz               NULL,
  -- Idempotence anti-spam (RG-NOTIF-016) : clé composite pour éviter les doublons
  -- Unicité sur (user_id, type, ref_id) quand lu=false : gérée applicativement (helper)
  created_at      timestamptz               NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'Notifications in-app Sprint 4 Visibilité. Créées uniquement par le helper interne insertNotification(). Jamais par endpoint public. Isolation multi-tenant via organisation_id (RLS).';
COMMENT ON COLUMN public.notifications.chantier_id IS
  'Référence chantier concerné. SET NULL si le chantier est supprimé (pas de CASCADE DELETE pour conserver l historique).';
COMMENT ON COLUMN public.notifications.tache_id IS
  'Référence tâche concernée (null pour types echeance_chantier, derive_budget). SET NULL si la tâche est supprimée.';
COMMENT ON COLUMN public.notifications.lu IS
  'false = non lu (contribue au badge). true = lu (read_at renseigné).';

-- ============================================================
-- 3. INDEX (performance sur les requêtes critiques)
-- ============================================================

-- Index principal : liste notifs d'un user non lues (badge + fil) — query la plus fréquente
CREATE INDEX IF NOT EXISTS idx_notifications_user_lu_created
  ON public.notifications(user_id, lu, created_at DESC);

-- Index secondaire : idempotence anti-spam (lookup type+ref non lus)
CREATE INDEX IF NOT EXISTS idx_notifications_type_ref
  ON public.notifications(user_id, type, chantier_id, tache_id)
  WHERE lu = false;

-- Index tertiaire : cleanup pg_cron par organisation (rétention)
CREATE INDEX IF NOT EXISTS idx_notifications_org_created
  ON public.notifications(organisation_id, created_at);

-- ============================================================
-- 4. RLS — isolation multi-tenant
-- ============================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policy lecture : un user ne voit que SES notifications de SON organisation
-- (JWT app_metadata.organisation_id = D-028 BINDING)
DO $$ BEGIN
  CREATE POLICY "notifications_select_own_org"
    ON public.notifications
    FOR SELECT
    USING (
      user_id = auth.uid()
      AND organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Policy INSERT : réservée au service_role (helper interne uniquement — D-029)
-- Les utilisateurs authentifiés ne peuvent jamais insérer directement
DO $$ BEGIN
  CREATE POLICY "notifications_insert_service_role_only"
    ON public.notifications
    FOR INSERT
    WITH CHECK (false);  -- Bloqué pour tous les rôles Supabase Auth ; INSERT via adminClient uniquement
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Policy UPDATE : un user ne peut marquer lu que SES propres notifications
DO $$ BEGIN
  CREATE POLICY "notifications_update_own"
    ON public.notifications
    FOR UPDATE
    USING (
      user_id = auth.uid()
      AND organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
    )
    WITH CHECK (
      user_id = auth.uid()
      AND organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Pas de DELETE policy pour les users (pas de suppression manuelle — purge = cron uniquement)

-- ============================================================
-- 5. GRANTs (D-029 : "Automatically expose new tables" = OFF)
-- ============================================================

GRANT ALL ON public.notifications TO service_role;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
-- INSERT et DELETE : service_role uniquement (via adminClient)

-- ============================================================
-- 6. HELPER SQL htmlEscape — défense en profondeur XSS côté cron (F004 / RG-NOTIF-005)
-- Ordre impératif : '&' EN PREMIER pour éviter la double-substitution.
-- Reproduit fidèlement le comportement du helper TS htmlEscape() :
--   & → &amp;   < → &lt;   > → &gt;   " → &quot;   ' → &#39;
-- Usage : sql_html_escape(colonne_text) dans les SELECT du cron.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sql_html_escape(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT replace(replace(replace(replace(replace(
    input,
    '&', '&amp;'),   -- EN PREMIER — évite double-encodage
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;')
$$;

-- ============================================================
-- 7. FUNCTION cron jalons dépassés
-- SECURITY DEFINER : s'exécute avec les privilèges du propriétaire de la function.
-- Owner attendu : rôle postgres (superuser Supabase hosted).
-- K4V-11 : documenter le owner — ce rôle est standard Supabase, pas sur-privilégié pour INSERT notifs.
-- ============================================================
CREATE OR REPLACE FUNCTION public.notif_jalons_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  today date := CURRENT_DATE;
BEGIN
  -- ---- Événement 4a : chantiers actifs dont date_fin_prevue < today ----
  -- Destinataires : admin + conducteur affectés à ce chantier (même organisation)
  INSERT INTO public.notifications (
    organisation_id, user_id, type, titre, message, chantier_id
  )
  SELECT
    c.organisation_id,
    u.id AS user_id,
    'echeance_chantier'::public.notification_type,
    -- htmlEscape SQL côté cron (RG-NOTIF-005 — défense en profondeur F004)
    'Chantier en retard : ' || public.sql_html_escape(c.nom),
    'La date de fin prévue du chantier « ' || public.sql_html_escape(c.nom) || ' » est dépassée depuis le ' || c.date_fin_prevue::text || '.',
    c.id AS chantier_id
  FROM public.chantiers c
  -- Destinataires : users de l'org avec rôle admin ou conducteur, non supprimés
  JOIN public.users u
    ON u.organisation_id = c.organisation_id
    AND u.role IN ('admin', 'conducteur')
    AND u.deleted_at IS NULL
  WHERE c.statut = 'actif'
    AND c.date_fin_prevue < today
  -- Idempotence : ne pas insérer si une notif non lue du même type + chantier existe déjà
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = u.id
      AND n.type = 'echeance_chantier'
      AND n.chantier_id = c.id
      AND n.lu = false
  );

  -- ---- Événement 4b : tâches actives dont date_echeance < today ----
  -- Destinataires : conducteur du chantier de la tâche
  INSERT INTO public.notifications (
    organisation_id, user_id, type, titre, message, chantier_id, tache_id
  )
  SELECT
    t.organisation_id,
    u.id AS user_id,
    'echeance_tache'::public.notification_type,
    -- htmlEscape SQL côté cron (RG-NOTIF-005 — défense en profondeur F004)
    'Échéance dépassée : ' || public.sql_html_escape(t.titre),
    'La tâche « ' || public.sql_html_escape(t.titre) || ' » sur le chantier « ' || public.sql_html_escape(c.nom) || ' » a dépassé son échéance du ' || t.date_echeance::text || '.',
    t.chantier_id,
    t.id AS tache_id
  FROM public.taches t
  JOIN public.chantiers c ON c.id = t.chantier_id AND c.statut = 'actif'
  -- Conducteur du chantier : premier conducteur affecté (PO-3-AM-01)
  JOIN (
    SELECT DISTINCT ON (a.chantier_id) a.chantier_id, a.user_id
    FROM public.affectations a
    JOIN public.users u2 ON u2.id = a.user_id AND u2.role = 'conducteur' AND u2.deleted_at IS NULL
    ORDER BY a.chantier_id, a.created_at ASC
  ) cond ON cond.chantier_id = t.chantier_id
  JOIN public.users u ON u.id = cond.user_id
  WHERE t.date_echeance IS NOT NULL
    AND t.date_echeance < today
    AND t.statut NOT IN ('termine')
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = u.id
      AND n.type = 'echeance_tache'
      AND n.tache_id = t.id
      AND n.lu = false
  );
END;
$$;

-- ============================================================
-- 8. Schedules pg_cron — conditionnels (si pg_cron absent, migration reste valide)
-- AMB-03 : cron.unschedule conditionnel AVANT cron.schedule (migration idempotente).
-- PO décision binding : branches conditionnelles, pas de RPC.
-- ============================================================

DO $$ BEGIN
  -- Déprogrammer si existe déjà (idempotence AMB-03)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notif-jalons-depassees') THEN
    PERFORM cron.unschedule('notif-jalons-depassees');
  END IF;
  -- Schedule : 06h00 UTC chaque matin
  PERFORM cron.schedule(
    'notif-jalons-depassees',
    '0 6 * * *',
    $cron$ SELECT public.notif_jalons_cron(); $cron$
  );
EXCEPTION
  WHEN undefined_function THEN
    RAISE WARNING 'pg_cron non disponible — schedule notif-jalons-depassees ignoré. Dette PROJECT_STATE.md.';
  WHEN undefined_table THEN
    RAISE WARNING 'pg_cron non disponible — schedule notif-jalons-depassees ignoré. Dette PROJECT_STATE.md.';
END $$;

DO $$ BEGIN
  -- Déprogrammer si existe déjà (idempotence AMB-03)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notif-purge-retention-90j') THEN
    PERFORM cron.unschedule('notif-purge-retention-90j');
  END IF;
  -- Schedule purge rétention 90j : dimanche 04h00 UTC (PO-4V-04 = B)
  PERFORM cron.schedule(
    'notif-purge-retention-90j',
    '0 4 * * 0',
    $cron$ DELETE FROM public.notifications WHERE created_at < NOW() - INTERVAL '90 days'; $cron$
  );
EXCEPTION
  WHEN undefined_function THEN
    RAISE WARNING 'pg_cron non disponible — schedule notif-purge-retention-90j ignoré. Dette PROJECT_STATE.md.';
  WHEN undefined_table THEN
    RAISE WARNING 'pg_cron non disponible — schedule notif-purge-retention-90j ignoré. Dette PROJECT_STATE.md.';
END $$;
