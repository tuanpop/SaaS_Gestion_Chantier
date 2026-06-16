-- Migration 019 : table action_proposals (Sprint 8 Bot extracteur d'actions)
-- Fichier : supabase/migrations/019_action_proposals.sql
-- Prérequis : migrations 001–018 appliquées.
-- Application : manuelle via Supabase Dashboard SQL editor. Idempotente.
-- ADR-013 BINDING : 4 types d'action.
-- ADR-007 BINDING étendu : le bot ne fait jamais d'action directement (validation conducteur obligatoire).
-- D-8-14 : chantier_id/organisation_id figés serveur — source d'autorité IDOR.
-- D-8-20 CRITICAL : ADD VALUE 'action_proposal' et 'alerte_chat' ISOLÉS EN FIN de migration,
--   chacun dans son propre DO $$, AUCUNE insertion de notification de ces types ici.
--   Leçon TST-K6-28 Sprint 6 / V-7-12 Sprint 7 : ADD VALUE ne peut être utilisé dans
--   la même transaction que son premier usage.

-- ============================================================
-- 1. ENUM action_type
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.action_type AS ENUM (
    'creer_tache',   -- INSERT dans taches
    'ajouter_cr',    -- Ajout de signaux au CR journalier du jour
    'replanifier',   -- UPDATE date_echeance (tache) ou date_fin_prevue (chantier)
    'alerte'         -- insertNotification ciblée
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. ENUM action_proposal_statut
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.action_proposal_statut AS ENUM (
    'pending',   -- Proposé par le bot, en attente de validation humaine (ADR-007)
    'valide',    -- Validé par conducteur/admin — en cours ou déjà exécuté
    'rejete',    -- Rejeté par conducteur/admin — aucune exécution
    'execute'    -- Exécuté avec succès après validation (transitions : pending→valide→execute)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3. TABLE action_proposals
-- D-8-14 : organisation_id/chantier_id figés serveur (source d'autorité IDOR — jamais du payload)
-- D-8-04 : RLS WITH CHECK(false) — écriture service_role uniquement
-- ============================================================

CREATE TABLE IF NOT EXISTS public.action_proposals (
  id                  uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid                          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id         uuid                          NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,

  -- Message source (le message qui a déclenché la proposition)
  -- ON DELETE CASCADE : si le message source est hard-deleted, la proposition est supprimée
  -- (les messages sont soft-deleted — pas de hard delete utilisateur V1, donc cascade rare)
  message_id          uuid                          NOT NULL REFERENCES messages(id) ON DELETE CASCADE,

  -- Type d'action proposée (ADR-013 BINDING)
  type                public.action_type            NOT NULL,

  -- Payload structuré de la proposition (JSON éditable par le conducteur avant validation)
  -- Structure varie selon le type (contrats TypeScript : PayloadCreerTache, PayloadAjouterCR, etc.)
  -- BINDING D-8-14 : le payload ne porte QUE des valeurs métier — JAMAIS chantier_id/organisation_id
  -- Validé par Zod (.strict()) côté handler PATCH valider et PATCH payload (EXI-Y-K8-06)
  payload             jsonb                         NOT NULL,

  -- Statut du workflow (ADR-007 étendu BINDING)
  -- Transitions autorisées : pending→valide, pending→rejete, valide→execute
  -- Toute autre transition → 409 (RG-ACTION-001)
  statut              public.action_proposal_statut NOT NULL DEFAULT 'pending',

  -- Qui a validé ou rejeté (conducteur ou admin)
  -- ON DELETE SET NULL : si le validateur est supprimé, la traçabilité reste (valide_at conservé)
  valide_par          uuid                          NULL REFERENCES users(id) ON DELETE SET NULL,
  valide_at           timestamptz                   NULL,

  -- Résultat de l'exécution (best-effort — RG-ACTION-008)
  -- Non null si exécution a échoué. statut reste 'valide', pas de rollback.
  erreur_execution    text                          NULL CHECK (char_length(erreur_execution) <= 2000),

  -- Ressource créée/modifiée lors de l'exécution (navigation depuis la proposition)
  -- creer_tache → tache_id ; replanifier → tache_id ou chantier_id ; alerte → null ; ajouter_cr → compte_rendu_id
  ressource_id        uuid                          NULL,
  ressource_type      text                          NULL CHECK (ressource_type IN ('tache', 'chantier', 'notification', 'compte_rendu')),

  created_at          timestamptz                   NOT NULL DEFAULT now(),
  updated_at          timestamptz                   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.action_proposals IS
  'Sprint 8 — Propositions d''actions générées par le bot Claw. ADR-013 BINDING : 4 types (creer_tache, ajouter_cr, replanifier, alerte). ADR-007 étendu : le bot ne fait JAMAIS d''action directement. Validation conducteur/admin obligatoire (pending→valide→execute). Rejet : pending→rejete. payload JSONB éditable avant validation. D-8-14 : chantier_id/organisation_id figés serveur (source IDOR).';

COMMENT ON COLUMN public.action_proposals.payload IS
  'Payload JSON structuré. Éditable par le conducteur avant validation (PATCH .../payload). D-8-14 BINDING : ne porte QUE des valeurs métier — jamais chantier_id/organisation_id. Validé par Zod strict() côté handler. Voir types/chat.ts pour les contrats par type d''action.';

COMMENT ON COLUMN public.action_proposals.erreur_execution IS
  'Non null si l''exécution a échoué après validation (best-effort RG-ACTION-008). La proposition reste en statut valide (pas de rollback sur la décision humaine). Le conducteur peut retenter ou créer manuellement.';

-- Index partiel pour la file de validation conducteur (p95 < 300ms — specs §8)
CREATE INDEX IF NOT EXISTS idx_action_proposals_chantier_pending
  ON public.action_proposals(chantier_id, created_at DESC)
  WHERE statut = 'pending';

-- Index pour le lien message → propositions
CREATE INDEX IF NOT EXISTS idx_action_proposals_message
  ON public.action_proposals(message_id);

-- Index pour la liste org (admin voit tout)
CREATE INDEX IF NOT EXISTS idx_action_proposals_org_created
  ON public.action_proposals(organisation_id, created_at DESC);

-- RLS — isolation multi-tenant (D-028 BINDING)
ALTER TABLE public.action_proposals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'action_proposals' AND policyname = 'action_proposals_select_own_org'
  ) THEN
    CREATE POLICY "action_proposals_select_own_org"
      ON public.action_proposals FOR SELECT
      USING (
        organisation_id = ((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
      );
  END IF;
END $$;

-- INSERT : service_role uniquement (le bot seul propose — D-8-04)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'action_proposals' AND policyname = 'action_proposals_insert_service_role_only'
  ) THEN
    CREATE POLICY "action_proposals_insert_service_role_only"
      ON public.action_proposals FOR INSERT
      WITH CHECK (false);
  END IF;
END $$;

-- UPDATE (workflow statut, payload, valide_par) : service_role uniquement
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'action_proposals' AND policyname = 'action_proposals_update_service_role_only'
  ) THEN
    CREATE POLICY "action_proposals_update_service_role_only"
      ON public.action_proposals FOR UPDATE
      WITH CHECK (false);
  END IF;
END $$;

-- DELETE : interdit (audit trail obligatoire — traçabilité des décisions conducteur)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'action_proposals' AND policyname = 'action_proposals_delete_forbidden'
  ) THEN
    CREATE POLICY "action_proposals_delete_forbidden"
      ON public.action_proposals FOR DELETE
      USING (false);
  END IF;
END $$;

GRANT ALL ON public.action_proposals TO service_role;
GRANT SELECT ON public.action_proposals TO authenticated;

-- ============================================================
-- 4. FK retour : messages.action_proposal_id → action_proposals(id)
-- Ajoutée APRÈS la création de action_proposals (référence circulaire gérée via ADD COLUMN IF NOT EXISTS)
-- ON DELETE SET NULL : soft-delete message → proposition conservée (audit trail)
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS action_proposal_id uuid NULL REFERENCES action_proposals(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.messages.action_proposal_id IS
  'Lien vers la proposition d''action associée à ce message bot (null pour les messages humains et système). ON DELETE SET NULL : la proposition reste si le message est hard-deleted (rare car soft-delete V1).';

-- ============================================================
-- 5. Extension enum notification_type — ADD VALUE ISOLÉS EN FIN DE MIGRATION
-- D-8-20 CRITICAL : chaque ADD VALUE dans son propre DO $$ BEGIN...END $$
-- Aucune insertion de notification de ces types dans cette migration.
-- Leçon TST-K6-28 Sprint 6 : ADD VALUE ne peut pas être utilisé dans la même transaction
-- que sa création. Isolation garantit la compatibilité Supabase transactionnel.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'action_proposal'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'action_proposal';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'alerte_chat'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'alerte_chat';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
