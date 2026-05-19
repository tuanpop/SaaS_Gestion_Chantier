-- ============================================================
-- 003_users_soft_delete.sql
--
-- Soft delete pour les users : conserve l'historique (taches.assigned_to,
-- affectations, chantiers.created_by) sans casser les FK.
-- Filtre `deleted_at IS NULL` côté code.
--
-- Idempotent (IF NOT EXISTS) — peut être rejoué sans effet secondaire.
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users (deleted_at) WHERE deleted_at IS NULL;
