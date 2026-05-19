-- Migration 004 — Index UNIQUE email exclut les soft-deleted
--
-- Bug observé prod 2026-05-19 : impossible de réinviter un email dont
-- l'utilisateur a été soft-deleted (deleted_at IS NOT NULL). L'index unique
-- créé en 001 ne distinguait que email NULL vs non-NULL — pas les soft-deleted.
-- Conséquence : duplicate key violation sur idx_users_email + état incohérent
-- (nouvel auth user créé via Supabase Auth, mais insert public.users fail).
--
-- Fix : recréer l'index en partial unique qui exclut aussi les soft-deleted.
-- Permet de soft-delete puis ré-inviter le même email proprement.
-- Idempotent (DROP IF EXISTS + CREATE).

DROP INDEX IF EXISTS public.idx_users_email;

CREATE UNIQUE INDEX idx_users_email ON public.users(email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;
