-- Migration 021 : pg_cron purge messages 90j + claw_accueil_log 30j (Sprint 8)
-- Fichier : supabase/migrations/021_pg_cron_purge_chat.sql
-- Prérequis : migrations 001–020 appliquées.
-- Application : manuelle via Supabase Dashboard SQL editor.
-- Décision Amelia (IMPLEMENTATION_PLAN §Décision) : migration 021 dédiée, séparée de 020.
-- Pattern conditionnel : vérifier NOT EXISTS(job) avant schedule (pattern Sprint 4 mig 009).
-- D-8-08 : messages > 90j (PO-8-03=B), claw_accueil_log > 30j (RG-ACCUEIL-008).
-- Pas supercronic (SQL-pur, pg_cron existant sur Supabase).

-- ============================================================
-- 1. Purge messages > 90 jours (PO-8-03=B)
-- Hebdomadaire : chaque dimanche à 03h00 UTC
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-chat-messages') THEN
      PERFORM cron.schedule(
        'purge-chat-messages',
        '0 3 * * 0',
        $$DELETE FROM public.messages WHERE created_at < NOW() - INTERVAL '90 days'$$
      );
    END IF;
  END IF;
END $$;

-- ============================================================
-- 2. Purge claw_accueil_log > 30 jours (RG-ACCUEIL-008)
-- Hebdomadaire : chaque dimanche à 03h00 UTC
-- Cohérent avec la purge des notifications (PO-4V-04 pattern Sprint 4)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-claw-accueil') THEN
      PERFORM cron.schedule(
        'purge-claw-accueil',
        '0 3 * * 0',
        $$DELETE FROM public.claw_accueil_log WHERE created_at < NOW() - INTERVAL '30 days'$$
      );
    END IF;
  END IF;
END $$;
