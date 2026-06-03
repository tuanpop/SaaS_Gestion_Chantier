-- Migration 007 — Table ouvrier_sessions (D-054 pivot Redis → Postgres)
-- Sprint 3 finalisation — ClawBTP
-- Auteur : Amelia | Date : 2026-06-03
-- Application : MANUELLE via Supabase Dashboard SQL editor (pattern migration 005, D-007)
-- Idempotente : IF NOT EXISTS

CREATE TABLE IF NOT EXISTS public.ouvrier_sessions (
  session_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  data            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

COMMENT ON TABLE public.ouvrier_sessions IS
  'Sessions ouvrier scan QR Sprint 3 (D-054 pivot Redis → Postgres). Sliding window TTL 7j via UPDATE expires_at a chaque hit getOuvrierSession. Invalidation cascade DELETE WHERE user_id sur DELETE affectation (D-3-011). Cleanup lazy : WHERE expires_at > NOW() a chaque read.';

CREATE INDEX IF NOT EXISTS idx_ouvrier_sessions_user
  ON public.ouvrier_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_ouvrier_sessions_expires
  ON public.ouvrier_sessions(expires_at);

-- GRANTs manuels obligatoires (D-029 : "Automatically expose new tables" = OFF)
GRANT ALL ON public.ouvrier_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ouvrier_sessions TO authenticated;

-- Pas de RLS : acces via adminClient (service_role) uniquement, defense applicative dans
-- lib/session-store.ts (D-3-002 helper-only pattern conserve).
