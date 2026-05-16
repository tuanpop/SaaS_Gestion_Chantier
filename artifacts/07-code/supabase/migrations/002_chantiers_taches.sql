-- Migration 002 — Chantiers, Affectations, Tâches — Sprint 2 ClawBTP
-- Date : 2026-05-15
-- Auteur : Amelia
--
-- Tables créées : chantiers, affectations, taches
-- ENUMs : chantier_statut, tache_statut, affectation_vue
-- RLS : isolation_org sur les 3 tables (pattern Sprint 1)
-- Index : idx_chantiers_org, idx_chantiers_statut_date, idx_affectations_*, idx_taches_chantier
--
-- Décisions :
--   Q1 (2026-05-15) : conducteur voit ses chantiers uniquement (créateur OU affecté)
--   Q2 (2026-05-15) : affectations.user_id accepte role IN ('ouvrier', 'conducteur')
--   Q5 (2026-05-15) : budget_alloue nullable
--   D-013 : soft delete chantiers (statut='archive') — pas de DELETE physique

-- ============================================================
-- ENUMs Sprint 2
-- ============================================================

-- Statuts chantier
CREATE TYPE chantier_statut AS ENUM ('actif', 'archive');

-- Statuts tâche
CREATE TYPE tache_statut AS ENUM ('a_faire', 'en_cours', 'termine', 'bloque');

-- Vue affectation ouvrier (Sprint 3 — prépare le sélecteur QR)
CREATE TYPE affectation_vue AS ENUM ('mes_taches', 'chantier_complet');

-- ============================================================
-- Table : chantiers
-- ============================================================

CREATE TABLE chantiers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  nom              text NOT NULL CHECK (char_length(nom) >= 1 AND char_length(nom) <= 100),
  client_nom       text NOT NULL CHECK (char_length(client_nom) >= 1 AND char_length(client_nom) <= 200),
  adresse          text NOT NULL,
  -- US-010 S2 : code postal 5 chiffres obligatoire
  code_postal      text NOT NULL CHECK (code_postal ~ '^\d{5}$'),
  -- Q5 (2026-05-15) : budget_alloue nullable
  -- La coloration traite budget_alloue IS NULL comme "pas de dérive budget calculable" = vert axe budget
  budget_alloue    numeric(12, 2) CHECK (budget_alloue > 0),
  budget_depense   numeric(12, 2) NOT NULL DEFAULT 0 CHECK (budget_depense >= 0),
  statut           chantier_statut NOT NULL DEFAULT 'actif',
  date_debut       date NOT NULL,
  date_fin_prevue  date NOT NULL CHECK (date_fin_prevue >= date_debut),
  -- nullable — remplie lors de l'archivage
  date_fin_reelle  date,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Table : affectations
-- ============================================================
-- Q2 (2026-05-15) : user_id accepte role IN ('ouvrier', 'conducteur')
-- Pas de contrainte CHECK sur le rôle en DB — enforced applicativement (C.3)
-- Pas d'affectation admin (admin gère, n'exécute pas sur le terrain)

CREATE TABLE affectations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chantier_id      uuid NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  vue              affectation_vue NOT NULL DEFAULT 'mes_taches',
  date_debut       date NOT NULL,
  -- nullable — affectation sans date de fin = active indéfiniment
  date_fin         date,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- specs.md : date_fin >= date_debut si date_fin non null
  CONSTRAINT affectations_dates_check CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

-- ============================================================
-- Table : taches
-- ============================================================

CREATE TABLE taches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id      uuid NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  titre            text NOT NULL CHECK (char_length(titre) >= 1 AND char_length(titre) <= 200),
  description      text,
  statut           tache_statut NOT NULL DEFAULT 'a_faire',
  -- nullable : tâche non assignée
  assigned_to      uuid REFERENCES users(id),
  -- nullable : pas toujours une date d'échéance définie
  date_echeance    date,
  -- Backup DB de la validation Zod côté API (garde primaire = Zod → HTTP 400 early return)
  -- Obligatoire (min 10 car.) si et seulement si statut = 'bloque' (US-011 S2, specs.md §modèle)
  bloque_raison    text CHECK (
    (statut = 'bloque' AND bloque_raison IS NOT NULL AND char_length(bloque_raison) >= 10)
    OR statut != 'bloque'
  ),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Trigger updated_at (CREATE OR REPLACE — safe si Sprint 1 l'a déjà créé)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER chantiers_updated_at
  BEFORE UPDATE ON chantiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER taches_updated_at
  BEFORE UPDATE ON taches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Index obligatoires (specs.md §Index)
-- ============================================================

-- Index principal chantiers par organisation
CREATE INDEX idx_chantiers_org ON chantiers(organisation_id);

-- Index pour tri portefeuille (date_fin_prevue fréquemment requêtée dans la coloration)
-- DoD US-010 S3 : 20 chantiers < 1s
CREATE INDEX idx_chantiers_statut_date ON chantiers(organisation_id, statut, date_fin_prevue);

-- Index affectations
CREATE INDEX idx_affectations_user_date ON affectations(user_id, date_debut, date_fin);
CREATE INDEX idx_affectations_chantier ON affectations(chantier_id);
CREATE INDEX idx_affectations_org ON affectations(organisation_id);

-- Index pour lookup affectations actives (US-004 sélecteur de chantier Sprint 3).
-- Note technique : on ne peut pas filtrer sur `CURRENT_DATE` dans un index partiel
-- car la fonction n'est pas IMMUTABLE (PG refuse). Le filtrage temporel se fait
-- au niveau requête. L'index couvre toutes les affectations (en cours et terminées)
-- sur (user_id, date_debut, date_fin) — suffisant pour la perf cible.
CREATE INDEX idx_affectations_active ON affectations(user_id, date_debut, date_fin);

-- Index taches par chantier
CREATE INDEX idx_taches_chantier ON taches(chantier_id);

-- ============================================================
-- Row Level Security — Pattern isolation_org (Sprint 1 obligatoire I-01)
-- ============================================================

-- Activation RLS immédiate à la création
ALTER TABLE chantiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE affectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE taches ENABLE ROW LEVEL SECURITY;

-- CHANTIERS : isolation_org
-- Tous les utilisateurs authentifiés (admin + conducteur) voient uniquement leur organisation
-- Note ouvriers : pas de JWT Supabase (has_supabase_auth=false) — accès filtré applicativement Sprint 3
CREATE POLICY "isolation_org" ON chantiers
  FOR ALL TO authenticated
  USING (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid)
  WITH CHECK (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid);

-- AFFECTATIONS : isolation_org
CREATE POLICY "isolation_org" ON affectations
  FOR ALL TO authenticated
  USING (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid)
  WITH CHECK (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid);

-- TACHES : isolation_org
CREATE POLICY "isolation_org" ON taches
  FOR ALL TO authenticated
  USING (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid)
  WITH CHECK (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid);

-- ============================================================
-- Amorce table chats (US-060 — Sprint 8)
-- ============================================================
-- La création d'un chantier doit automatiquement créer le chat associé
-- La table chats sera créée en migration 006_chat.sql (Sprint 8)
-- La création du chat est stubée côté API avec :
--   // TODO Sprint 8 : INSERT INTO chats (chantier_id, organisation_id) VALUES (...)
-- Aucune création effective ici.
