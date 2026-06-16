# Application des migrations 014 et 015 — Sprint 6 IA Détection proactive des dérives
*Produit : 2026-06-16 | Tanjiro | Sprint 6*
*Références : D-6-02, D-6-06, D-6-07, D-6-08, D-6-09, D-6-13, ADR-6-002, ADR-6-004, ADR-6-005, ADR-6-006*
*Cibles : Supabase Dashboard > SQL Editor (application manuelle)*

---

## Ordre obligatoire : 014 AVANT 015

La migration 015 (`seuils_derives`) référence le type `organisation_id` et dépend du contexte multi-tenant
déjà établi. Surtout, l'extension de l'enum `notification_type` avec `'derive_proactive'` est dans 014 —
le code qui l'utilise sera déployé en même temps. Appliquer 015 avant 014 ne casse rien en soi, mais 014
avant 015 est l'ordre canonique documenté (specs §2.2/§2.3 / architecture §5.1).

---

## Pré-requis avant d'appliquer

- [ ] Le code Sprint 6 est buildé et prêt au déploiement (ou déployé en même temps)
- [ ] Migrations 001 à 013 confirmées appliquées en prod (voir PROJECT_STATE.md)
- [ ] Accès au SQL Editor Supabase Dashboard avec rôle service_role

---

## Étape 1 — Audit initial (optionnel mais recommandé)

Exécuter ces requêtes dans SQL Editor pour confirmer l'état avant migration :

```sql
-- 1a. Vérifier que les migrations précédentes sont en place (table notifications doit exister)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('notifications', 'chantiers', 'taches', 'organisations');
-- Attendu : 4 lignes

-- 1b. Vérifier que derives_detectees n'existe pas encore
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'derives_detectees';
-- Attendu : 0 lignes

-- 1c. Vérifier que seuils_derives n'existe pas encore
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'seuils_derives';
-- Attendu : 0 lignes

-- 1d. Vérifier l'enum notification_type existant (doit contenir les valeurs Sprint 4/5)
SELECT unnest(enum_range(NULL::notification_type))::text AS valeur;
-- Attendu : les valeurs existantes (assignation_tache, statut_tache, derive_budget, jalons, etc.)
-- derive_proactive ne doit PAS encore être présente

-- 1e. Vérifier que l'enum derive_type n'existe pas encore
SELECT typname FROM pg_type WHERE typname = 'derive_type';
-- Attendu : 0 lignes
```

---

## Étape 2 — Appliquer migration 014 : `derives_detectees`

Ouvrir Supabase Dashboard > **Database** > **SQL Editor** > **New query**.

Copier-coller le contenu du fichier `artifacts/07-code/supabase/migrations/014_derives_detectees.sql`
(produit par Amelia) et exécuter.

**Points de vigilance V-14 (BINDING) :**

Le `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'derive_proactive'` doit être isolé dans
son propre bloc `DO $$ ... $$` en fin de migration 014, **après** la création de la table et des index.
Il ne peut PAS s'exécuter dans la même transaction que du code qui utilise cette valeur.

Si Amelia a respecté l'architecture §5.1 note V-14, la migration est structurée ainsi :
1. `CREATE TYPE derive_type AS ENUM (...)`
2. `CREATE TABLE derives_detectees (...)`
3. `CREATE INDEX ...` (index lecture + idempotence)
4. `ALTER TABLE derives_detectees ENABLE ROW LEVEL SECURITY`
5. Policies RLS (SELECT org, INSERT/UPDATE WITH CHECK(false), pas de DELETE)
6. GRANTs (ALL service_role, SELECT authenticated)
7. `DO $$ BEGIN ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'derive_proactive'; END $$;`

Résultat attendu : `Success. No rows returned.`

### Vérifications post-migration 014

```sql
-- 2a. Table créée
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'derives_detectees';
-- Attendu : 1 ligne

-- 2b. Colonnes attendues
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'derives_detectees'
ORDER BY ordinal_position;
-- Attendu : id, organisation_id, chantier_id, type (derive_type), tache_id (nullable),
--           detected_at, resolved_at (nullable), signal_valeur, message_llm (nullable),
--           notification_id (nullable), llm_erreurs

-- 2c. Index unique partiel (idempotence D-6-06)
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'derives_detectees'
  AND indexname = 'uq_derive_active_chantier_type_tache';
-- Attendu : 1 ligne, WHERE clause contient "resolved_at IS NULL"

-- 2d. Index de lecture
SELECT indexname FROM pg_indexes
WHERE tablename = 'derives_detectees'
  AND indexname IN (
    'idx_derives_chantier_active',
    'idx_derives_org_active',
    'idx_derives_tache'
  );
-- Attendu : 3 lignes

-- 2e. RLS activé + policies
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'derives_detectees';
-- Attendu : rowsecurity = true

SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'derives_detectees';
-- Attendu : au moins 1 policy SELECT (org = JWT), INSERT WITH CHECK(false), UPDATE WITH CHECK(false)

-- 2f. GRANTs
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'derives_detectees'
ORDER BY grantee, privilege_type;
-- Attendu : service_role = ALL ; authenticated = SELECT uniquement

-- 2g. Enum derive_type créé
SELECT unnest(enum_range(NULL::derive_type))::text AS valeur;
-- Attendu : budget_depasse, retard_date_fin, tache_bloquee_longue, inactivite_chantier

-- 2h. notification_type étendu
SELECT unnest(enum_range(NULL::notification_type))::text AS valeur;
-- Attendu : les valeurs existantes + derive_proactive (présente maintenant)

-- 2i. Tester l'idempotence : un double INSERT doit retourner 0 ligne insérée
-- (test avec une valeur fictive — à ajuster selon la structure réelle)
INSERT INTO derives_detectees (organisation_id, chantier_id, type, signal_valeur)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'budget_depasse',
  '{"ratio": 0.92}'::jsonb
)
ON CONFLICT ON CONSTRAINT uq_derive_active_chantier_type_tache DO NOTHING;
-- Si la contrainte s'appelle différemment, utiliser ON CONFLICT DO NOTHING

-- Insérer une 2e fois identique
INSERT INTO derives_detectees (organisation_id, chantier_id, type, signal_valeur)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'budget_depasse',
  '{"ratio": 0.92}'::jsonb
)
ON CONFLICT ON CONSTRAINT uq_derive_active_chantier_type_tache DO NOTHING;

-- Vérifier : 1 seule ligne avec ces IDs fictifs
SELECT COUNT(*) FROM derives_detectees
WHERE chantier_id = '00000000-0000-0000-0000-000000000002';
-- Attendu : 1

-- Nettoyer après test
DELETE FROM derives_detectees
WHERE chantier_id = '00000000-0000-0000-0000-000000000002';
```

---

## Étape 3 — Appliquer migration 015 : `seuils_derives`

**APRÈS** que la migration 014 a été confirmée (Étape 2 complète).

Copier-coller le contenu du fichier `artifacts/07-code/supabase/migrations/015_seuils_derives.sql`
(produit par Amelia) et exécuter dans SQL Editor.

Résultat attendu : `Success. No rows returned.`

### Vérifications post-migration 015

```sql
-- 3a. Table créée
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'seuils_derives';
-- Attendu : 1 ligne

-- 3b. Colonnes et défauts
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'seuils_derives'
ORDER BY ordinal_position;
-- Attendu : organisation_id (uuid, NOT NULL), ratio_budget (numeric, default 0.85),
--           jours_blocage (int, default 3), jours_inactivite (int, default 7),
--           updated_at (timestamptz)

-- 3c. Contrainte UNIQUE organisation_id
SELECT constraint_name, constraint_type FROM information_schema.table_constraints
WHERE table_schema = 'public' AND table_name = 'seuils_derives'
  AND constraint_type = 'UNIQUE';
-- Attendu : 1 ligne

-- 3d. CHECK bornes (EXI-Y-K6-07 BINDING)
SELECT constraint_name, check_clause FROM information_schema.check_constraints
WHERE constraint_schema = 'public'
  AND constraint_name LIKE '%seuils%' OR constraint_name LIKE '%ratio%';
-- Attendu : une contrainte contenant ratio_budget >= 0.50 AND ratio_budget < 1
-- et jours_blocage >= 1 et jours_inactivite >= 1

-- Vérification directe : tenter d'insérer une valeur hors borne doit échouer
-- (test de la contrainte CHECK — attendu : ERROR violation)
INSERT INTO seuils_derives (organisation_id, ratio_budget)
VALUES ('00000000-0000-0000-0000-000000000099', 0.40);
-- Attendu : ERROR — violation de la contrainte CHECK (ratio_budget >= 0.50)
-- Si succès inattendu : le CHECK est absent, BLOCKER à corriger avant le déploiement

-- 3e. RLS activé + policies admin only
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'seuils_derives';
-- Attendu : rowsecurity = true

SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'seuils_derives';
-- Attendu : SELECT filtrée role='admin' + org JWT ; INSERT/UPDATE WITH CHECK(false) ; DELETE USING(false)

-- 3f. GRANTs
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'seuils_derives'
ORDER BY grantee, privilege_type;
-- Attendu : service_role = ALL ; authenticated = SELECT uniquement
```

---

## Idempotence des migrations

Les deux migrations sont **idempotentes via `IF NOT EXISTS`** sur les CREATE. Si une migration est
ré-appliquée par erreur :
- `CREATE TABLE IF NOT EXISTS` → no-op si déjà présente
- `CREATE INDEX IF NOT EXISTS` → no-op
- `ALTER TYPE ... ADD VALUE IF NOT EXISTS` → no-op si valeur déjà présente

En cas d'erreur partielle (migration interrompue à mi-chemin) : inspecter l'état avec les requêtes
de vérification ci-dessus et identifier ce qui manque avant de ré-appliquer.

---

## Note sur l'enum `notification_type` et les transactions PG (V-14)

`ALTER TYPE ... ADD VALUE` **ne peut pas s'exécuter dans la même transaction** que du code qui
utilise la nouvelle valeur. L'architecture §5.1 prescrit de l'isoler en fin de migration 014 dans
un bloc `DO $$ ... $$` séparé. La valeur `derive_proactive` sera disponible pour le code applicatif
dès que la migration 014 est committée — pas besoin d'attendre 015.

**Conséquence déploiement** : si le code est déployé avant la migration 014, tout appel à
`insertNotification` avec `type: 'derive_proactive'` échouera (valeur enum inconnue de PG). L'ordre
recommandé est donc : migrations d'abord, déploiement code ensuite. Voir checklist Sprint 6.

---

## Rollback

Les tables étant vides au déploiement initial, le rollback est simple :

```sql
-- Rollback 015 (si 015 seule à rollback)
DROP TABLE IF EXISTS seuils_derives;

-- Rollback 014 (si les deux à rollback — attention : supprime aussi les dérives)
DROP TABLE IF EXISTS derives_detectees;
DROP TYPE IF EXISTS derive_type;
-- NOTE : ALTER TYPE ... ADD VALUE est irréversible en PG sans recréer le type.
-- L'enum notification_type conservera 'derive_proactive' même après rollback 014.
-- Ce n'est pas bloquant : la valeur est ignorée si aucun code ne l'insère.
```

**Rollback code** : Dokploy > service > Deployments > sélectionner le deploy Sprint 5 stable > Redeploy.
Le code Sprint 5 ignore les tables `derives_detectees`/`seuils_derives` (inconnues de lui).
