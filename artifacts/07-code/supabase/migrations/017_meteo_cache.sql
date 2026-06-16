-- Migration 017 : table meteo_cache (Sprint 7 — cache OpenWeather par code_postal)
-- Fichier : supabase/migrations/017_meteo_cache.sql
-- Prérequis : migrations 001–016 appliquées.
-- TTL 6 heures par code_postal (RYO-7-06 / D-7-06).
-- Le cron lit le cache avant d'appeler OpenWeather. Si cache valide : réutilise. Sinon : appel API + INSERT.
-- SECURITE : table technique non scopée org (météo publique, D-08/D-7-06 justifié — TST-K7-26).
--           Accès exclusif service_role (RLS USING(false), aucun GRANT authenticated — D-7-10).

CREATE TABLE IF NOT EXISTS public.meteo_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_postal   text        NOT NULL UNIQUE CHECK (code_postal ~ '^\d{5}$'),

  -- Coordonnées résolues via API Geocoding OpenWeather
  -- Stockées pour éviter de ré-appeler le geocoding à chaque fois (RG-METEO-002)
  latitude      numeric(9, 6) NULL,
  longitude     numeric(9, 6) NULL,

  -- Réponse brute One Call 3.0 (daily[] 7 jours)
  -- Parse défensif à la lecture (cache corrompu → re-fetch, edge 807)
  data          jsonb       NOT NULL,

  -- TTL : entrée valide si fetched_at + 6h > NOW()
  fetched_at    timestamptz NOT NULL DEFAULT now(),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meteo_cache IS
  'Cache météo OpenWeather par code postal (Sprint 7). TTL 6 heures (RYO-7-06). Lecture : SELECT WHERE code_postal = X AND fetched_at > NOW() - INTERVAL 6 HOURS. Écriture : INSERT ON CONFLICT DO UPDATE. Nettoyage : entrées > 24h supprimées par le cron (D-7-14). Table technique — pas de donnée org, pas de PII. Accès exclusif service_role (RLS USING false).';

COMMENT ON COLUMN public.meteo_cache.data IS
  'Réponse brute OpenWeather One Call 3.0. Structure principale utilisée : data.daily[] (array 7 éléments). Chaque élément : { dt, temp: {min, max}, weather: [{description}], pop, rain, wind_speed }. Parse défensif Zod à la lecture — JSON invalide → re-fetch.';

COMMENT ON COLUMN public.meteo_cache.code_postal IS
  'Code postal français 5 chiffres. Clé de cache partagée entre tous les chantiers du même CP (D-7-06 — météo publique, non scopée org).';

CREATE INDEX IF NOT EXISTS idx_meteo_cache_code_postal
  ON public.meteo_cache(code_postal, fetched_at DESC);

-- RLS : accès exclusif service_role (D-7-10 — table technique)
-- USING(false) : aucun utilisateur authenticated ne peut lire la table
-- WITH CHECK(false) : aucun utilisateur authenticated ne peut écrire
ALTER TABLE public.meteo_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meteo_cache_service_role_only"
  ON public.meteo_cache
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT ALL ON public.meteo_cache TO service_role;
-- Pas de GRANT authenticated : la météo n'est pas accessible directement en JSON brut (D-7-10 / TST-K7-26/27)
-- Les données météo sont incluses dans la réponse GET /api/briefings/[id] (meteo_jours calculé depuis meteo_snapshot)
