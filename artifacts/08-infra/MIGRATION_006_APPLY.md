# Procédure d'application — Migration 006
*Produit : 2026-06-02 | Tanjiro | Sprint 3 ClawBTP*
*Ref. architecturale : D-3-007 | Ref. securite : K3-CR-02, K3-CR-04 (TNJ-K3-08)*

Migration 006 ajoute la colonne `note_privee_conducteur` sur la table `taches` et l'index partiel `idx_affectations_user_active` sur `affectations`. Elle est idempotente (`IF NOT EXISTS`). Application manuelle via Supabase Dashboard SQL Editor, cohérent avec la precedente migration 005.

---

## Prerequis

- Acces au projet Supabase ClawBTP (compte tpopulo@orkesyn.com ou invite Organisation)
- URL dashboard : https://supabase.com/dashboard/project/[PROJECT_ID]/sql
- Les migrations 001 a 005 DOIVENT etre appliquees. Si tu as un doute, execute l'etape AUDIT ETAT INITIAL ci-dessous avant toute chose.

---

## Etape 0 — Audit etat initial (avant migration)

Ouvre le SQL Editor Supabase et execute les 3 requetes suivantes pour photographier l'etat avant migration. Aucune ne modifie la base.

**Requete 0a — Verifier que la colonne n'existe PAS encore**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'taches'
  AND column_name  = 'note_privee_conducteur';
```

Resultat attendu AVANT migration : **0 lignes** (la colonne n'existe pas).
Si la requete retourne 1 ligne, la migration a deja ete appliquee. Skip a l'etape VERIF POST-MIGRATION.

**Requete 0b — Verifier que l'index n'existe PAS encore**

```sql
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname  = 'idx_affectations_user_active';
```

Resultat attendu AVANT migration : **0 lignes** (l'index n'existe pas).

**Requete 0c — Compter les migrations deja appliquees (reference)**

```sql
SELECT COUNT(*) AS nb_migrations_connues
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('taches', 'affectations', 'users', 'chantiers', 'organisations');
```

Resultat attendu : **5** (toutes les tables de base existent).

---

## Etape 1 — Appliquer la migration

**1a.** Dans Supabase Dashboard, aller dans **SQL Editor** (menu gauche > SQL Editor > + New query).

**1b.** Copier-coller exactement le SQL suivant :

```sql
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
```

**1c.** Cliquer sur **Run** (bouton vert ou Ctrl+Entrée).

Resultat attendu : `Success. No rows returned.`

S'il y a une erreur, lire le message et consulter la section TROUBLESHOOTING en bas de ce document.

---

## Etape 2 — Verifications post-migration

Execute ces 3 requetes apres avoir applique la migration pour confirmer le succes.

**Requete 2a — La colonne existe**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'taches'
  AND column_name  = 'note_privee_conducteur';
```

Resultat attendu APRES migration :

| column_name | data_type | is_nullable | column_default |
|---|---|---|---|
| note_privee_conducteur | text | YES | NULL |

**Requete 2b — L'index existe**

```sql
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname  = 'idx_affectations_user_active';
```

Resultat attendu APRES migration : **1 ligne** avec :
- `indexname` = `idx_affectations_user_active`
- `tablename` = `affectations`
- `indexdef` contient `WHERE (deleted_at IS NULL)`

**Requete 2c — Le commentaire est pose**

```sql
SELECT col_description(
  'public.taches'::regclass,
  (SELECT ordinal_position FROM information_schema.columns
   WHERE table_schema='public' AND table_name='taches' AND column_name='note_privee_conducteur')
) AS commentaire;
```

Resultat attendu : la chaine `Note interne conducteur — JAMAIS exposee via /api/ouvrier/*...`

---

## Etape 3 — Documenter (obligatoire)

Apres application reussie :

1. Dans `memory/PROJECT_STATE.md`, section "Infrastructure production" > "Migrations appliquees en prod", cocher la ligne `[ ] Migration 006` et noter la date.
2. Dans `artifacts/08-infra/SPRINT_3_INFRA_CHECKLIST.md`, cocher la case "Migration 006 appliquee Supabase Dashboard".

---

## Rollback (si besoin)

A n'executer QUE si la migration a provoque un probleme inattendu. En temps normal, la migration est idempotente et sans risque (elle n'efface aucune donnee existante).

**Condition de rollback** : la colonne vient d'etre creee et aucune donnee n'a encore ete ecrite dans `note_privee_conducteur` (i.e. sprint 3 pas encore deploye en prod).

```sql
-- ROLLBACK MIGRATION 006
-- A executer UNIQUEMENT si la colonne est vide (aucune donnee Sprint 3)
-- Verifier d'abord :
SELECT COUNT(*) FROM public.taches WHERE note_privee_conducteur IS NOT NULL;
-- Si = 0, tu peux rollback :

ALTER TABLE public.taches DROP COLUMN IF EXISTS note_privee_conducteur;
DROP INDEX IF EXISTS public.idx_affectations_user_active;
```

**Impact code du rollback** :
- Les endpoints `/api/ouvrier/*` NE tomberaient PAS (ils ne referencent jamais ce champ).
- Les tests Vitest portant sur `note_privee_conducteur` (tests shape) passeraient toujours (le champ serait absent = attendu).
- En revanche : l'endpoint `PATCH /api/taches/[id]` (conducteur) echouerait sur toute tentative d'ecriture dans `note_privee_conducteur` (colonne inexistante). Les logs pino emettraient une erreur Postgres `42703 column does not exist`.
- L'index `idx_affectations_user_active` etant supprime, les requetes RBAC ouvrier fonctionneraient toujours (fallback scan sequentiel) mais avec une latence plus elevee sur `affectations`.

**Conclusion** : le rollback est bas-risque si aucune donnee n'a ete ecrite. Si des donnees conducteur existent deja dans `note_privee_conducteur`, le rollback est destructif — ne pas rollback dans ce cas.

---

## Troubleshooting

| Erreur | Cause probable | Action |
|--------|----------------|--------|
| `ERROR: column "note_privee_conducteur" of relation "taches" already exists` | La migration est deja appliquee | Inoffensif si `IF NOT EXISTS` est present. Verifier le SQL copie. Sinon, passer directement a l'etape VERIF POST-MIGRATION. |
| `ERROR: relation "taches" does not exist` | Migration 001/002 non appliquee | Appliquer les migrations anterieures dans l'ordre. |
| `ERROR: relation "affectations" does not exist` | Migration 001/002 non appliquee | Idem. |
| `ERROR: permission denied for table taches` | Connexion en tant que `anon` ou `authenticated` sans privileges suffisants | Utiliser la connexion `postgres` (superuser) dans le SQL Editor Supabase. Par defaut, l'editeur SQL Supabase Dashboard tourne en tant que `postgres` — pas de probleme attendu. |
| `ERROR: index "idx_affectations_user_active" already exists` | L'index existe deja | Inoffensif si `IF NOT EXISTS` est present. Verifier le SQL copie. |

---

## Reference SQL canonique (source)

Le fichier source de verite est :
`artifacts/07-code/supabase/migrations/006_taches_note_privee_conducteur.sql`

Ce document reproduit exactement son contenu. En cas de divergence, le fichier `.sql` fait foi.
