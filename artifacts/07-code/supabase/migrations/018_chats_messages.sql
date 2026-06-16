-- Migration 018 : tables chats et messages (Sprint 8 Chat d'équipe)
-- Fichier : supabase/migrations/018_chats_messages.sql
-- Prérequis : migrations 001–017 appliquées.
-- Application : manuelle via Supabase Dashboard SQL editor. Idempotente (IF NOT EXISTS + DO $$ EXCEPTION).
-- 1 chat = 1 chantier (WON'T HAVE V1 : pas de DM, pas de chat hors chantier).
-- D-8-04 : RLS WITH CHECK(false) sur INSERT/UPDATE — écriture uniquement via adminClient (service_role).
-- D-8-20 : ADD VALUE notification_type isolé en fin de migration 019 (pas ici).

-- ============================================================
-- 1. ENUM message_type
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.message_type AS ENUM (
    'user',    -- Message posté par un humain (admin, conducteur, ouvrier)
    'bot',     -- Réponse du bot Claw (@claw inline ou accueil)
    'system'   -- Événement système (création chat, archivage chantier, etc.)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. TABLE chats
-- 1 ligne par chantier ayant un chat actif.
-- D-8-01 : 1 chat = 1 chantier (UNIQUE sur chantier_id)
-- D-8-04 : RLS — écriture service_role uniquement
-- D-029 : GRANTs explicites
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chats (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id     uuid        NOT NULL UNIQUE REFERENCES chantiers(id) ON DELETE CASCADE,

  -- Compteur dénormalisé pour l'affichage du badge "N messages"
  -- Mis à jour dans le handler POST message (best-effort, non via trigger)
  messages_count  integer     NOT NULL DEFAULT 0 CHECK (messages_count >= 0),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.chats IS
  'Sprint 8 — 1 chat par chantier (WON''T HAVE : pas de DM, pas de chat hors chantier). Clé unique sur chantier_id. Créé automatiquement à la création du chantier (RYO-8-01 / PO-8-04=A). Les participants sont les membres rattachés au chantier (affectations actives + admin org). D-8-04 : écriture service_role uniquement (RLS WITH CHECK(false)).';

COMMENT ON COLUMN public.chats.messages_count IS
  'Compteur dénormalisé du nombre de messages dans ce chat. Incrémenté dans le handler POST message (non via trigger). Tolérance aux écarts mineurs (non critique).';

CREATE INDEX IF NOT EXISTS idx_chats_chantier
  ON public.chats(chantier_id);

CREATE INDEX IF NOT EXISTS idx_chats_org
  ON public.chats(organisation_id, created_at DESC);

-- RLS — isolation multi-tenant (D-028 BINDING)
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- Lecture : membres de la même organisation
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chats' AND policyname = 'chats_select_own_org'
  ) THEN
    CREATE POLICY "chats_select_own_org"
      ON public.chats FOR SELECT
      USING (
        organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
      );
  END IF;
END $$;

-- INSERT : service_role uniquement (création via handler qui utilise adminClient)
-- service_role bypasse la RLS par construction — WITH CHECK(false) bloque PostgREST authenticated
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chats' AND policyname = 'chats_insert_service_role_only'
  ) THEN
    CREATE POLICY "chats_insert_service_role_only"
      ON public.chats FOR INSERT
      WITH CHECK (false);
  END IF;
END $$;

-- UPDATE (messages_count) : service_role uniquement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chats' AND policyname = 'chats_update_service_role_only'
  ) THEN
    CREATE POLICY "chats_update_service_role_only"
      ON public.chats FOR UPDATE
      WITH CHECK (false);
  END IF;
END $$;

-- DELETE : interdit (le chat est supprimé en CASCADE via chantier ON DELETE CASCADE)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chats' AND policyname = 'chats_delete_forbidden'
  ) THEN
    CREATE POLICY "chats_delete_forbidden"
      ON public.chats FOR DELETE
      USING (false);
  END IF;
END $$;

GRANT ALL ON public.chats TO service_role;
GRANT SELECT ON public.chats TO authenticated;

-- ============================================================
-- 3. TABLE messages
-- D-8-03 : type forcé 'user' pour humains via handler (INSERT 'bot'/'system' = service_role uniquement)
-- D-8-05 : soft-delete via deleted_at (modération admin PO-8-06=A)
-- D-8-04 : RLS WITH CHECK(false) sur INSERT/UPDATE
-- D-8-06 : index idx_messages_chat_created pour pagination cursor ASC
-- D-045 BINDING : taches n'a pas deleted_at — ce commentaire est ici pour rappel de non-confusion
-- ============================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id         uuid                  NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  organisation_id uuid                  NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id     uuid                  NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,

  -- Auteur : null pour les messages system (auteur_id ON DELETE SET NULL)
  auteur_id       uuid                  NULL REFERENCES users(id) ON DELETE SET NULL,

  type            public.message_type   NOT NULL,

  -- Contenu brut du message
  -- BINDING : htmlEscape() OBLIGATOIRE avant rendu HTML ou notification
  -- BINDING : escapeDelimiter() OBLIGATOIRE avant insertion dans prompt LLM
  -- BINDING : note_privee_conducteur JAMAIS dans ce champ (D-051)
  contenu         text                  NOT NULL CHECK (char_length(contenu) BETWEEN 1 AND 4000),

  -- Soft delete (PO-8-06=A / D-8-05) — admin uniquement
  -- Contenu conservé en base pour audit. API retourne "[Message supprimé]" si deleted_at IS NOT NULL.
  deleted_at      timestamptz           NULL,

  -- Référence à une action_proposal liée (null si message ordinaire)
  -- FK ajoutée dans migration 019 après création de action_proposals
  action_proposal_id  uuid              NULL,  -- FK : REFERENCES action_proposals(id) ON DELETE SET NULL (mig 019)

  created_at      timestamptz           NOT NULL DEFAULT now(),
  updated_at      timestamptz           NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messages IS
  'Sprint 8 — Messages du chat chantier. type=user : humain. type=bot : réponse Claw (inline ou accueil). type=system : événement automatique. contenu max 4000 chars. Soft delete via deleted_at (D-8-05) : contenu remplacé par "[Message supprimé]" dans l''UI, entrée conservée pour audit.';

COMMENT ON COLUMN public.messages.contenu IS
  'Contenu brut. htmlEscape() OBLIGATOIRE avant tout rendu HTML. escapeDelimiter() OBLIGATOIRE avant insertion dans un prompt LLM. note_privee_conducteur JAMAIS dans ce champ (D-051 BINDING).';

COMMENT ON COLUMN public.messages.deleted_at IS
  'Soft delete (D-8-05 / PO-8-06=A) : non null = message supprimé par admin. L''UI affiche "[Message supprimé]" à la place du contenu. auteur_id conservé pour audit.';

-- Index pour la pagination cursor chronologique (D-8-06)
-- ordre ASC pour affichage chronologique ; cursor-based sur created_at
CREATE INDEX IF NOT EXISTS idx_messages_chat_created
  ON public.messages(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_auteur
  ON public.messages(auteur_id)
  WHERE auteur_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_org_created
  ON public.messages(organisation_id, created_at DESC);

-- Index pour la détection des messages non analysés par le pipeline bot (RG-BOT-001)
CREATE INDEX IF NOT EXISTS idx_messages_pending_bot
  ON public.messages(chat_id, created_at)
  WHERE type = 'user' AND deleted_at IS NULL;

-- RLS — isolation multi-tenant (D-028 BINDING)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_select_own_org'
  ) THEN
    CREATE POLICY "messages_select_own_org"
      ON public.messages FOR SELECT
      USING (
        organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
      );
  END IF;
END $$;

-- INSERT : service_role uniquement (D-8-04 — forger un message bot / spoofing auteur interdit)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_insert_service_role_only'
  ) THEN
    CREATE POLICY "messages_insert_service_role_only"
      ON public.messages FOR INSERT
      WITH CHECK (false);
  END IF;
END $$;

-- UPDATE (soft delete deleted_at) : service_role uniquement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_update_service_role_only'
  ) THEN
    CREATE POLICY "messages_update_service_role_only"
      ON public.messages FOR UPDATE
      WITH CHECK (false);
  END IF;
END $$;

-- DELETE : interdit (audit trail — soft delete suffisant)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_delete_forbidden'
  ) THEN
    CREATE POLICY "messages_delete_forbidden"
      ON public.messages FOR DELETE
      USING (false);
  END IF;
END $$;

GRANT ALL ON public.messages TO service_role;
GRANT SELECT ON public.messages TO authenticated;
