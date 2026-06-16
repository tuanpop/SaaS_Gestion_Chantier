-- Migration 020 : table claw_accueil_log (Sprint 8 Feature #9 Accueil Claw)
-- Fichier : supabase/migrations/020_claw_accueil_log.sql
-- Prérequis : migrations 001–019 appliquées.
-- Application : manuelle via Supabase Dashboard SQL editor. Idempotente.
-- D-8-16 : idempotence 1 accueil/ouvrier/jour (uq_claw_accueil_user_date).
-- D-8-04 : FOR ALL USING(false) — table technique, aucun accès PostgREST authenticated.
-- RG-ACCUEIL-008 : purge pg_cron > 30j — dans migration 021.

-- ============================================================
-- TABLE claw_accueil_log
-- Traçabilité des accueils Claw envoyés aux ouvriers.
-- 1 accueil max par (user_id, date_accueil) — idempotence "premier scan du jour".
-- Lecture : service_role uniquement (table interne, pas exposée via API publique).
-- D-8-16 : INSERT avec ON CONFLICT (user_id, date_accueil) DO NOTHING pour idempotence scan.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.claw_accueil_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id uuid        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id     uuid        NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,

  -- Date calendaire UTC du scan (clé d'idempotence avec user_id)
  -- DEFAULT CURRENT_DATE = date serveur UTC au moment de l'INSERT
  date_accueil    date        NOT NULL DEFAULT CURRENT_DATE,

  -- Contenu généré par Haiku (texte affiché dans la bannière PWA)
  -- null si génération Haiku a échoué ou trial fallback déterministe sans LLM
  contenu         text        NULL CHECK (char_length(contenu) <= 1000),

  -- Métadonnées de génération (audit coût / qualité)
  -- meteo_disponible = true si meteo_cache valide au moment de la génération
  -- llm_utilise = false si trial_expired → fallback déterministe sans Haiku (D-8-18 / RG-ACCUEIL-007)
  meteo_disponible  boolean   NOT NULL DEFAULT false,
  llm_utilise       boolean   NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.claw_accueil_log IS
  'Sprint 8 Feature #9 — Traçabilité des accueils Claw envoyés aux ouvriers lors du premier scan QR du jour. 1 accueil max par (user_id, date_accueil) — index unique garantit l''idempotence. Nettoyage : entrées > 30 jours supprimées par pg_cron (migration 021). Table interne : FOR ALL USING(false), aucun accès PostgREST authenticated.';

COMMENT ON COLUMN public.claw_accueil_log.contenu IS
  'Texte de l''accueil Claw (≤1000 chars). Généré par Haiku (llm_utilise=true) ou déterministe (trial fallback, llm_utilise=false). Stocké pour ré-affichage sans re-génération (GET /api/ouvrier/accueil-claw).';

COMMENT ON COLUMN public.claw_accueil_log.llm_utilise IS
  'false si org trial_expired → contenu déterministe sans Haiku (D-8-18 / RG-ACCUEIL-007). Audit du coût LLM.';

-- Idempotence : 1 accueil par user par jour calendaire UTC
-- INSERT avec ON CONFLICT (user_id, date_accueil) DO NOTHING dans le handler QR
CREATE UNIQUE INDEX IF NOT EXISTS uq_claw_accueil_user_date
  ON public.claw_accueil_log(user_id, date_accueil);

CREATE INDEX IF NOT EXISTS idx_claw_accueil_org
  ON public.claw_accueil_log(organisation_id, date_accueil DESC);

-- RLS : table technique interne — aucun accès PostgREST authenticated
-- service_role bypasse la RLS par construction (D-8-04)
ALTER TABLE public.claw_accueil_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'claw_accueil_log' AND policyname = 'claw_accueil_log_service_role_only'
  ) THEN
    CREATE POLICY "claw_accueil_log_service_role_only"
      ON public.claw_accueil_log FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

GRANT ALL ON public.claw_accueil_log TO service_role;
-- Pas de GRANT authenticated : table interne non exposée via API publique (D-8-04)
