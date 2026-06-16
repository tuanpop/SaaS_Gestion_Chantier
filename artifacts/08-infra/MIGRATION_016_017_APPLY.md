# Application des migrations 016 et 017 — Sprint 7 IA Briefing Automatique Lundi Matin
*Produit : 2026-06-16 | Tanjiro | Sprint 7*
*Références : D-7-01, D-7-06, D-7-10, D-7-12, D-7-14, V-7-09, V-7-12, ADR-7-001→004*
*Cibles : Supabase Dashboard > SQL Editor (application manuelle)*

---

## Ordre obligatoire global : 014 → 015 → 016 → 017

Sprint 7 suppose que 014 (`derives_detectees`) et 015 (`seuils_derives`) sont déjà appliquées
en production (ces migrations appartiennent à Sprint 6 — cf. `MIGRATION_014_015_APPLY.md`).

Si la prod est encore à 001-013 (Sprint 6 non déployé), appliquer dans cet ordre :
```
014 → 015 → 016 → 017
```

Si la prod est à 013 uniquement (cas actuel selon PROJECT_STATE.md au 2026-06-16) :
l'application de 014/015 est prérequis impératif avant 016/017.

---

## Pré-requis avant d'appliquer

- [ ] Migrations 001 à 015 confirmées appliquées en prod (ou à défaut : 001-013, auquel cas appliquer 014+015 en premier)
- [ ] Code Sprint 7 buildé et prêt (ou déployé en même temps, APRÈS les migrations)
- [ ] `OPENWEATHER_API_KEY` ajoutée dans Dokploy (voir section "Variables d'environnement" dans `SPRINT_7_INFRA_CHECKLIST.md`)
- [ ] Accès SQL Editor Supabase Dashboard avec rôle service_role

---

## Étape 1 — Audit initial (recommandé)

```sql
-- 1a. Vérifier l'état des migrations Sprint 6 (derives_detectees et seuils_derives)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('derives_detectees', 'seuils_derives');
-- Attendu : 2 lignes (si Sprint 6 appliqué)
-- Si 0 lignes : appliquer d'abord 014 puis 015 (MIGRATION_014_015_APPLY.md)

-- 1b. Vérifier que briefings n'existe pas encore
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'briefings';
-- Attendu : 0 lignes

-- 1c. Vérifier que meteo_cache n'existe pas encore
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'meteo_cache';
-- Attendu : 0 lignes

-- 1d. Vérifier l'enum notification_type actuel
SELECT unnest(enum_range(NULL::notification_type))::text AS valeur;
-- Attendu : valeurs existantes (jalons, assignation_tache, etc., derive_proactive si Sprint 6 OK)
-- briefing_lundi ne doit PAS encore être présent

-- 1e. Vérifier que l'enum notification_type contient derive_proactive (Sprint 6)
-- Si absent : migration 014 incomplète — blocker avant de continuer
```

---

## Étape 2 — Appliquer migration 016 : `briefings`

Ouvrir Supabase Dashboard > **Database** > **SQL Editor** > **New query**.

Copier-coller le contenu du fichier `artifacts/07-code/supabase/migrations/016_briefings.sql`
(produit par Amelia) et exécuter.

**Points de vigilance V-7-12 (BINDING) :**

La migration 016 contient en fin de fichier :
```sql
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'briefing_lundi';
END $$;
```

Ce bloc `DO $$...$$` est **isolé** — il ne s'exécute PAS dans la même transaction que la
création de la table ou des index. C'est obligatoire : `ALTER TYPE ... ADD VALUE` ne peut pas
être dans la même transaction que du code qui utilise la nouvelle valeur (contrainte PG).

Structure attendue de 016 :
1. `CREATE TABLE IF NOT EXISTS briefings (...)` avec `contenu_genere TEXT CHECK (char_length <= 8000)`, `message_fallback TEXT CHECK (char_length <= 2000)`, etc.
2. `CREATE UNIQUE INDEX IF NOT EXISTS uq_briefing_chantier_semaine ON briefings (chantier_id, annee_iso, semaine_iso)`
3. `CREATE INDEX IF NOT EXISTS idx_briefings_org_created ...`
4. `CREATE INDEX IF NOT EXISTS idx_briefings_chantier_created ...`
5. `CREATE INDEX IF NOT EXISTS idx_briefings_semaine ...`
6. `ALTER TABLE briefings ENABLE ROW LEVEL SECURITY`
7. Policies RLS : SELECT org JWT, INSERT WITH CHECK(false), UPDATE WITH CHECK(false)
8. GRANTs : `GRANT ALL TO service_role`, `GRANT SELECT TO authenticated`
9. `DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'briefing_lundi'; END $$;`

Résultat attendu : `Success. No rows returned.`

### Vérifications post-migration 016

```sql
-- 2a. Table briefings créée
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'briefings';
-- Attendu : 1 ligne

-- 2b. Colonnes attendues (liste non exhaustive — vérifier les colonnes critiques)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'briefings'
ORDER BY ordinal_position;
-- Attendu : id (uuid), organisation_id (uuid), chantier_id (uuid), annee_iso (int),
--           semaine_iso (int), contenu_genere (text, nullable), message_fallback (text, nullable),
--           donnees_brutes (jsonb), meteo_snapshot (jsonb, nullable), code_postal (text, nullable),
--           llm_utilise (bool, default false), meteo_disponible (bool, default false),
--           llm_erreurs (int), meteo_erreurs (int), created_at (timestamptz), notification_ids (uuid[])

-- 2c. Index unique d'idempotence (D-7-01 BINDING)
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'briefings'
  AND indexname = 'uq_briefing_chantier_semaine';
-- Attendu : 1 ligne, ON briefings (chantier_id, annee_iso, semaine_iso)

-- 2d. Index de lecture
SELECT indexname FROM pg_indexes
WHERE tablename = 'briefings'
  AND indexname IN (
    'idx_briefings_org_created',
    'idx_briefings_chantier_created',
    'idx_briefings_semaine'
  );
-- Attendu : 3 lignes

-- 2e. RLS activé
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'briefings';
-- Attendu : rowsecurity = true

-- 2f. Policies RLS
SELECT policyname, cmd, qual FROM pg_policies
WHERE tablename = 'briefings';
-- Attendu :
--   SELECT policy : qual contient "organisation_id = (app_metadata ->> 'organisation_id')::uuid"
--   INSERT policy : with_check = 'false'
--   UPDATE policy : with_check = 'false'
--   PAS de DELETE policy (briefings immuables, D-7-09)

-- 2g. GRANTs
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'briefings'
ORDER BY grantee, privilege_type;
-- Attendu : service_role = ALL ; authenticated = SELECT uniquement (pas INSERT/UPDATE/DELETE)

-- 2h. Enum notification_type étendu avec briefing_lundi
SELECT unnest(enum_range(NULL::notification_type))::text AS valeur;
-- Attendu : valeurs existantes + briefing_lundi (présent maintenant)

-- 2i. CHECK contenu_genere (longueur max 8000)
SELECT constraint_name, check_clause FROM information_schema.check_constraints
WHERE constraint_schema = 'public'
  AND check_clause LIKE '%contenu_genere%' OR check_clause LIKE '%8000%';
-- Attendu : contrainte CHECK (char_length(contenu_genere) <= 8000)

-- 2j. CHECK code_postal (format 5 chiffres)
SELECT constraint_name, check_clause FROM information_schema.check_constraints
WHERE constraint_schema = 'public'
  AND check_clause LIKE '%code_postal%';
-- Attendu : contrainte CHECK (code_postal ~ '^\d{5}$') ou IS NULL

-- 2k. Test idempotence ON CONFLICT DO NOTHING
INSERT INTO briefings (organisation_id, chantier_id, annee_iso, semaine_iso,
                        donnees_brutes, llm_utilise, meteo_disponible, llm_erreurs, meteo_erreurs)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  2026, 25,
  '{}'::jsonb,
  false, false, 0, 0
);
-- Insérer une 2e fois identique (même chantier, même semaine)
INSERT INTO briefings (organisation_id, chantier_id, annee_iso, semaine_iso,
                        donnees_brutes, llm_utilise, meteo_disponible, llm_erreurs, meteo_erreurs)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  2026, 25,
  '{}'::jsonb,
  false, false, 0, 0
)
ON CONFLICT (chantier_id, annee_iso, semaine_iso) DO NOTHING;
-- Attendu : la 2e insertion retourne 0 lignes insérées (pas d'erreur)

-- Vérifier : 1 seule ligne
SELECT COUNT(*) FROM briefings
WHERE chantier_id = '00000000-0000-0000-0000-000000000002';
-- Attendu : 1

-- Nettoyer
DELETE FROM briefings WHERE chantier_id = '00000000-0000-0000-0000-000000000002';
```

---

## Étape 3 — Appliquer migration 017 : `meteo_cache`

**APRÈS** que la migration 016 est confirmée (Étape 2 complète).

Copier-coller le contenu du fichier `artifacts/07-code/supabase/migrations/017_meteo_cache.sql`
(produit par Amelia) et exécuter dans SQL Editor.

Résultat attendu : `Success. No rows returned.`

### Vérifications post-migration 017

```sql
-- 3a. Table meteo_cache créée
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'meteo_cache';
-- Attendu : 1 ligne

-- 3b. Colonnes attendues
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'meteo_cache'
ORDER BY ordinal_position;
-- Attendu : code_postal (text, NOT NULL, UNIQUE), latitude (numeric(9,6), nullable),
--           longitude (numeric(9,6), nullable), data (jsonb, NOT NULL), fetched_at (timestamptz)

-- 3c. Contrainte UNIQUE code_postal
SELECT constraint_name, constraint_type FROM information_schema.table_constraints
WHERE table_schema = 'public' AND table_name = 'meteo_cache'
  AND constraint_type = 'UNIQUE';
-- Attendu : 1 ligne (unique sur code_postal)

-- 3d. CHECK code_postal format 5 chiffres
SELECT constraint_name, check_clause FROM information_schema.check_constraints
WHERE constraint_schema = 'public'
  AND check_clause LIKE '%meteo%' OR check_clause LIKE '%code_postal%';
-- Attendu : contrainte CHECK (code_postal ~ '^\d{5}$')

-- 3e. RLS activé — USING(false) + WITH CHECK(false) — aucun accès authenticated (D-7-10)
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'meteo_cache';
-- Attendu : rowsecurity = true

SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE tablename = 'meteo_cache';
-- Attendu : policy ALL avec USING(false) et WITH CHECK(false)
-- Aucune lecture/écriture par authenticated — table technique service_role only

-- 3f. GRANTs — service_role uniquement, AUCUN authenticated
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'meteo_cache'
ORDER BY grantee, privilege_type;
-- Attendu : service_role = ALL
-- authenticated : 0 lignes (aucun GRANT — D-7-10 / D-029 BINDING)

-- 3g. Index lecture cache
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'meteo_cache';
-- Attendu : idx_meteo_cache_code_postal (ou similaire) sur (code_postal, fetched_at DESC)

-- 3h. Test UPSERT (comportement correct)
INSERT INTO meteo_cache (code_postal, data, fetched_at)
VALUES ('75001', '{"test": true}'::jsonb, NOW())
ON CONFLICT (code_postal) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at;
-- Attendu : Success. No rows returned. (upsert sans erreur)

-- Re-upsert pour confirmer l'idempotence
INSERT INTO meteo_cache (code_postal, data, fetched_at)
VALUES ('75001', '{"test": true, "refresh": 1}'::jsonb, NOW())
ON CONFLICT (code_postal) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at;
-- Attendu : Success. (update de la ligne existante)

SELECT data FROM meteo_cache WHERE code_postal = '75001';
-- Attendu : {"test": true, "refresh": 1}

-- Nettoyer
DELETE FROM meteo_cache WHERE code_postal = '75001';
```

---

## Idempotence des migrations

Les deux migrations sont idempotentes via `IF NOT EXISTS` sur les CREATE :
- `CREATE TABLE IF NOT EXISTS` → no-op si déjà présente
- `CREATE UNIQUE INDEX IF NOT EXISTS` → no-op
- `CREATE INDEX IF NOT EXISTS` → no-op
- `ALTER TYPE ... ADD VALUE IF NOT EXISTS` → no-op si valeur déjà présente (016 uniquement)

En cas d'erreur partielle (migration interrompue) : inspecter l'état avec les requêtes de
vérification ci-dessus pour identifier ce qui manque, puis ré-appliquer.

---

## Note critique — enum `notification_type` + transactions PG (V-7-12 BINDING)

`ALTER TYPE ... ADD VALUE` **ne peut pas s'exécuter dans la même transaction** que du code qui
utilise la nouvelle valeur. La migration 016 isole le `ADD VALUE 'briefing_lundi'` dans son
propre bloc `DO $$ ... $$` en fin de fichier — cette valeur sera disponible dès que la migration
est committée.

**Conséquence déploiement critique** : le code qui insère une notification `type: 'briefing_lundi'`
(dans le cron `/api/cron/briefing`) **ne peut être déployé avant** que la migration 016 soit
appliquée. L'enum PostgreSQL ne connaîtra pas la valeur → erreur `invalid input value for enum`.

Ordre impératif : **migration 016 → migration 017 → déploiement code Sprint 7**.

---

## Rollback

Les tables étant vides au déploiement initial, le rollback est simple :

```sql
-- Rollback 017 (si 017 seule à rollback)
DROP TABLE IF EXISTS meteo_cache;

-- Rollback 016 (si les deux à rollback — attention : supprime les briefings)
DROP TABLE IF EXISTS briefings;
-- NOTE : ALTER TYPE ... ADD VALUE est irréversible en PG sans recréer le type.
-- L'enum notification_type conservera 'briefing_lundi' même après rollback 016.
-- Ce n'est pas bloquant : la valeur est ignorée si aucun code ne l'insère.
```

**Rollback code** : Dokploy > service > Deployments > sélectionner le deploy Sprint 6 stable > Redeploy.
Le code Sprint 6 ignore les tables `briefings`/`meteo_cache` (inconnues de lui).
La ligne crontab `30 6 * * 1 /api/cron/briefing` sera inactive (endpoint inexistant → curl `-sf` sort en erreur, supercronic log l'échec mais continue).
