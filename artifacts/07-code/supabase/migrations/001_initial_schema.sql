-- Migration 001 — Schéma initial ClawBTP Sprint 1
-- Date : 2026-05-14
-- Auteur : Amelia
--
-- Tables créées : organisations, users
-- RLS : activée immédiatement à la création (I-01)
-- Index : idx_users_org, idx_users_email (specs.md §Index)
-- Note : colonne `statut` sur organisations ajoutée vs specs.md (décision humaine 2026-05-14)

-- ============================================================
-- Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Types ENUM
-- ============================================================

CREATE TYPE organisation_plan AS ENUM ('starter', 'pro', 'business');

-- Statut explicite (décision humaine 2026-05-14 — extension du schéma specs.md)
-- Documenté dans DECISIONLOG.md : nécessaire pour trial-gate.ts
-- Alternative écartée : dériver le statut de trial_ends_at < now() uniquement
CREATE TYPE organisation_statut AS ENUM ('trial_active', 'trial_expired', 'active', 'suspended');

CREATE TYPE user_role AS ENUM ('admin', 'conducteur', 'ouvrier');

CREATE TYPE invitation_status AS ENUM ('pending', 'active', 'expired');

-- ============================================================
-- Table : organisations
-- Tenant root — une organisation = une PME BTP cliente
-- ============================================================

CREATE TABLE organisations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (char_length(name) >= 2 AND char_length(name) <= 100),
  plan           organisation_plan NOT NULL DEFAULT 'starter',
  -- Statut explicite (décision humaine 2026-05-14)
  statut         organisation_statut NOT NULL DEFAULT 'trial_active',
  trial_ends_at  timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Table : users
-- admin/conducteur : a un compte Supabase Auth (id = auth.uid())
-- ouvrier : fiche sans compte Supabase Auth (id = gen_random_uuid())
-- ============================================================

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  role              user_role NOT NULL,
  nom               text NOT NULL CHECK (char_length(nom) >= 1 AND char_length(nom) <= 100),
  prenom            text NOT NULL CHECK (char_length(prenom) >= 1 AND char_length(prenom) <= 100),
  telephone         text CHECK (telephone ~ '^\+?[0-9]{10,15}$'),
  email             text,           -- nullable pour ouvriers (specs.md §Modèle de données)
  qr_token          text UNIQUE,    -- chiffré AES-256-GCM — ouvriers uniquement (S-01)
  has_supabase_auth boolean NOT NULL DEFAULT false,
  invitation_status invitation_status,  -- null pour ouvriers
  avatar_url        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Index obligatoires Sprint 1 (specs.md §Index)
-- ============================================================

-- Index principal performance multi-tenant (specs.md §Index obligatoires)
CREATE INDEX idx_users_org ON users(organisation_id);

-- Index UNIQUE conditionnel email — RGPD : email nullable pour ouvriers
-- Contrainte UNIQUE uniquement sur les emails non-null (specs.md §Contrainte RGPD)
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;

-- ============================================================
-- Row Level Security (RLS)
-- Activée immédiatement à la création (I-01)
-- Pattern isolation_org : chaque tenant ne voit que ses données
-- ============================================================

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Policy organisations : admin voit uniquement son organisation
-- JWT custom claim organisation_id injecté par auth-hook (S-02)
CREATE POLICY "isolation_org" ON organisations
  FOR ALL
  TO authenticated
  USING (
    id = (auth.jwt() ->> 'organisation_id')::uuid
  )
  WITH CHECK (
    id = (auth.jwt() ->> 'organisation_id')::uuid
  );

-- Policy users : membres voient uniquement les users de leur organisation
-- JWT custom claim organisation_id injecté par auth-hook (S-02)
CREATE POLICY "isolation_org" ON users
  FOR ALL
  TO authenticated
  USING (
    organisation_id = (auth.jwt() ->> 'organisation_id')::uuid
  )
  WITH CHECK (
    organisation_id = (auth.jwt() ->> 'organisation_id')::uuid
  );

-- ============================================================
-- Auth Hook — custom_access_token_hook (PostgreSQL function)
-- Injecte organisation_id + role dans le JWT Supabase
-- Requis pour auth.jwt() ->> 'organisation_id' dans les policies RLS (S-02)
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  v_user_id uuid;
  v_user_record record;
BEGIN
  -- Extraire le user_id depuis l'événement Supabase Auth
  v_user_id := (event ->> 'user_id')::uuid;

  -- Récupérer organisation_id et role depuis la table users
  -- SECURITY DEFINER : bypass RLS pour que l'hook puisse lire avant que les claims existent
  SELECT organisation_id, role
  INTO v_user_record
  FROM public.users
  WHERE id = v_user_id;

  -- Récupérer les claims existants
  claims := event -> 'claims';

  IF v_user_record IS NOT NULL THEN
    -- Injecter organisation_id et role dans app_metadata
    -- Ces claims seront accessibles via auth.jwt() ->> 'organisation_id' dans les policies RLS
    claims := jsonb_set(claims, '{app_metadata}',
      COALESCE(claims -> 'app_metadata', '{}'::jsonb)
      || jsonb_build_object(
        'organisation_id', v_user_record.organisation_id::text,
        'role', v_user_record.role::text
      )
    );
  END IF;

  -- Retourner l'événement avec les claims mis à jour
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Accorder les droits d'exécution à supabase_auth_admin
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- Révoquer l'exécution publique (SECURITY DEFINER — doit être restrictif)
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;

-- ============================================================
-- Politique RLS pour l'auth hook (SECURITY DEFINER bypass)
-- L'hook tourne avec les droits de son owner (postgres) — pas de policy nécessaire
-- ============================================================

-- Note : la fonction custom_access_token_hook est SECURITY DEFINER,
-- elle s'exécute avec les droits du owner (postgres/service role) et bypass RLS.
-- C'est intentionnel : elle doit lire les users AVANT que les claims JWT existent.
