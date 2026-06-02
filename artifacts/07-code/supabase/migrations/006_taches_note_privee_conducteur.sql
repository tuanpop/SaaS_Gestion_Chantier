-- Migration 006 — Ajout colonne note_privee_conducteur + index affectations actives
-- Sprint 3 — ClawBTP
-- Auteur : Amelia | Date : 2026-06-02
-- Application : MANUELLE via Supabase Dashboard SQL editor (pattern migration 005, D-007)
-- Idempotente : IF NOT EXISTS sur ALTER TABLE et CREATE INDEX

-- ============================================================
-- 1. Colonne note_privee_conducteur sur la table taches
-- ============================================================
-- D-051/PO-014 : champ interne conducteur, JAMAIS expose via /api/ouvrier/*
-- D-3-004 : SELECT explicite obligatoire sur toute table contenant ce champ
-- D-029 : pas de GRANT supplementaire (colonne sur table existante, RLS existant couvre)
ALTER TABLE public.taches
  ADD COLUMN IF NOT EXISTS note_privee_conducteur text NULL;

COMMENT ON COLUMN public.taches.note_privee_conducteur IS
  'Note interne conducteur — JAMAIS exposee via /api/ouvrier/* (D-051/PO-014 + D-3-004). SELECT explicite obligatoire sur toute requete ouvrier.';

-- ============================================================
-- 2. Index sur affectations pour accelerer les verifications RBAC ouvrier
-- ============================================================
-- D-3-007 : index requis pour les queries RBAC ouvrier (affectations actives par user + chantier)
-- WHERE deleted_at IS NULL : index partiel — evite d'indexer les affectations supprimees
CREATE INDEX IF NOT EXISTS idx_affectations_user_active
  ON public.affectations(user_id, chantier_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Note : pas de RLS supplementaire (D-3-007)
-- La securite col note_privee_conducteur est assuree par :
--   1. SELECT explicite dans tous les handlers ouvrier (D-3-004)
--   2. Type TypeScript TacheOuvrier sans ce champ (defense compilation)
--   3. Tests Vitest shape assertion (D4 specs DoD)
--   4. CI grep anti-reference dans /api/ouvrier/ (K3-CR-02)
-- ============================================================
