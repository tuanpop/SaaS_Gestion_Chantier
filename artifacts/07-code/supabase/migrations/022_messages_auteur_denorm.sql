-- Migration 022 : colonnes dénormalisées auteur_nom / auteur_role sur messages (Sprint 8 — correctif drift)
-- Fichier : supabase/migrations/022_messages_auteur_denorm.sql
-- Prérequis : migrations 001–021 appliquées (en particulier 018 qui crée messages).
-- Application : manuelle via Supabase Dashboard SQL editor. Idempotente (ADD COLUMN IF NOT EXISTS).
--
-- CONTEXTE : la migration 018 a créé public.messages sans auteur_nom ni auteur_role,
-- alors que tout le code (INSERT user/bot/system, GET select, type MessageChat, UI) les utilise.
-- Symptôme : POST /api/chantiers/[id]/chat/messages → "Could not find the 'auteur_nom' column".
--
-- Choix dénormalisé (cohérent avec le code existant) :
--   - auteur_nom  : "prénom + nom" résolu au moment de l'envoi (snapshot historique du chat),
--                   'Claw' pour les messages bot, 'Système' pour les messages system. NULL toléré.
--   - auteur_role : 'admin' | 'conducteur' | 'ouvrier' au moment de l'envoi ; NULL pour bot/system.
-- text (pas enum) — cohérent avec types/database.ts (string | null) et messages bot/system NULL.
--
-- GRANTs : couverts par le GRANT SELECT table-level de la migration 018 (les nouvelles
-- colonnes héritent du grant de table). RLS inchangée.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS auteur_nom  text NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS auteur_role text NULL;

COMMENT ON COLUMN public.messages.auteur_nom IS
  'Snapshot dénormalisé du nom affiché de l''auteur au moment de l''envoi (prénom + nom). ''Claw'' pour les messages bot, ''Système'' pour les messages system. NULL toléré.';

COMMENT ON COLUMN public.messages.auteur_role IS
  'Snapshot dénormalisé du rôle de l''auteur au moment de l''envoi (admin/conducteur/ouvrier). NULL pour les messages bot/system.';

-- ============================================================
-- 2. organisation_id auto-rempli depuis le chat (NOT NULL)
-- ------------------------------------------------------------
-- CONTEXTE : public.messages.organisation_id est NOT NULL (mig 018), mais AUCUN
-- des INSERT applicatifs (message user, message bot/system) ne le fournit.
-- Symptôme après ajout d'auteur_nom : null value in column "organisation_id" violates NOT NULL.
--
-- Choix : trigger BEFORE INSERT qui dérive organisation_id du chat (chats.organisation_id).
-- Garantit la cohérence multi-tenant (org du message = org du chat) côté DB, sans
-- dépendre de chaque appelant. Si organisation_id est fourni explicitement, il est conservé.
-- ============================================================

CREATE OR REPLACE FUNCTION public.messages_set_organisation_id()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.organisation_id IS NULL THEN
    SELECT c.organisation_id INTO NEW.organisation_id
    FROM public.chats c
    WHERE c.id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_messages_set_org ON public.messages;
CREATE TRIGGER trg_messages_set_org
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_set_organisation_id();

-- Recharger le cache de schéma PostgREST (sinon "column not found in schema cache" persiste)
NOTIFY pgrst, 'reload schema';
