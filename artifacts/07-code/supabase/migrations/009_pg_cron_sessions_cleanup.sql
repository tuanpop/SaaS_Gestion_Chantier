-- Migration 009 : pg_cron job cleanup sessions expirees (S4-F04, D-4-011)
-- Fichier : supabase/migrations/009_pg_cron_sessions_cleanup.sql
-- Application : manuelle via Supabase Dashboard SQL editor.
--
-- PREREQUIS : extension pg_cron doit etre activee sur le projet Supabase.
-- Verifier via Dashboard Supabase > Database > Extensions > pg_cron.
-- Si pg_cron absent : SKIP cette migration + documenter dette PROJECT_STATE.md
--   (seuil d'alerte : table ouvrier_sessions > 10 000 lignes, jamais atteint en pilote 60j).
--
-- Strategie : job daily a 03h00 UTC — supprime les lignes ouvrier_sessions
-- dont expires_at < NOW() (K4-MED-09b : condition stricte < NOW(), pas <=).
-- Complementaire a la defense lazy read (WHERE expires_at > NOW() dans sessionStore.read).

-- 1. Activer pg_cron si pas deja fait (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Supprimer le job si deja present (idempotent)
SELECT cron.unschedule('cleanup-ouvrier-sessions-expires')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-ouvrier-sessions-expires'
);

-- 3. Creer le job
SELECT cron.schedule(
  'cleanup-ouvrier-sessions-expires',    -- nom du job (unique)
  '0 3 * * *',                           -- daily a 03h00 UTC
  $$
    DELETE FROM public.ouvrier_sessions
    WHERE expires_at < NOW();
  $$
);

-- 4. Verification (executer separement pour confirmation)
-- SELECT * FROM cron.job WHERE jobname = 'cleanup-ouvrier-sessions-expires';
