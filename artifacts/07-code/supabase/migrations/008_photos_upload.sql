-- Migration 008 : table photos (upload ouvrier Sprint 4)
-- Fichier : supabase/migrations/008_photos_upload.sql
-- Application : manuelle via Supabase Dashboard SQL editor (coherent 005/006/007).
-- Idempotente : IF NOT EXISTS.
-- Prerequis : migrations 006 + 007 appliquees. Bucket Storage 'photos' cree (voir §2.3 archi).

-- ============================================================
-- 1. Table photos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.photos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tache_id        uuid        NOT NULL REFERENCES taches(id) ON DELETE CASCADE,
  organisation_id uuid        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploader_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- storage_path : chemin dans le bucket Supabase Storage (jamais l'URL publique)
  -- Format : {organisation_id}/{tache_id}/{photo_id}.{ext}
  -- JAMAIS exposer directement — utiliser les signed URLs (D-4-006)
  storage_path    text        NOT NULL,
  commentaire     text        NULL CHECK (char_length(commentaire) <= 500),
  -- mime_type : valide a l'upload, stocke pour audit (A1 — PO-4-02 BINDING post-HITL)
  -- HEIC retire (D-056/PO-4-02 amende 2026-06-07) : whitelist stricte JPEG/PNG/WebP
  mime_type       text        NOT NULL CHECK (mime_type IN (
                                'image/jpeg', 'image/png', 'image/webp'
                              )),
  -- taille en octets — validee avant upload (D-4-005)
  taille_octets   integer     NOT NULL CHECK (taille_octets > 0 AND taille_octets <= 10485760),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.photos IS
  'Photos uploadees par les ouvriers sur leurs taches (Sprint 4). '
  'storage_path = chemin bucket prive Supabase Storage. '
  'URLs : signed URLs TTL 1h generees a chaque affichage (PO-4-03, D-4-004). '
  'Hard delete + remove Storage best-effort (D-4-009). '
  'HEIC retire (D-056/PO-4-02 amende 2026-06-07 — whitelist stricte JPEG/PNG/WebP).';

COMMENT ON COLUMN public.photos.storage_path IS
  'Chemin dans bucket Supabase Storage (prive). '
  'Format : {organisation_id}/{tache_id}/{photo_id}.{ext}. '
  'NE JAMAIS exposer directement — utiliser les signed URLs (D-4-006).';

-- ============================================================
-- 2. Index
-- ============================================================
-- Lookup par tache (galerie, count)
CREATE INDEX IF NOT EXISTS idx_photos_tache_id
  ON public.photos(tache_id);

-- Lookup par organisation (securite multi-tenant — defense en profondeur)
CREATE INDEX IF NOT EXISTS idx_photos_organisation_id
  ON public.photos(organisation_id);

-- Lookup par uploader (pour le DELETE "mes photos")
CREATE INDEX IF NOT EXISTS idx_photos_uploader_id
  ON public.photos(uploader_id);

-- ============================================================
-- 3. Trigger updated_at
-- ============================================================
-- Le trigger set_updated_at est suppose deja present sur la DB (migrations 001/002).
DROP TRIGGER IF EXISTS photos_set_updated_at ON public.photos;
CREATE TRIGGER photos_set_updated_at
  BEFORE UPDATE ON public.photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. RLS
-- ============================================================
-- Les ouvriers n'ont pas de session Supabase Auth — RLS applicatif (pattern Sprint 3, D-3-005).
-- Pour conducteur/admin (JWT Supabase Auth) : policy standard par organisation_id.
-- Le service_role bypass la RLS — toutes les ops ouvrier passent par service_role (D-4-001).

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photos_org_isolation" ON public.photos;
CREATE POLICY "photos_org_isolation"
  ON public.photos
  FOR ALL
  TO authenticated
  USING (
    organisation_id = (
      (auth.jwt() -> 'app_metadata') ->> 'organisation_id'
    )::uuid
  );

-- ============================================================
-- 5. GRANTs (D-029 — Automatically expose new tables = OFF)
-- ============================================================
GRANT ALL ON public.photos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos TO authenticated;
