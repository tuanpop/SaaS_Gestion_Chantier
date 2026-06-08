# Procédure d'application — Migrations 008 + 009 + Bucket Storage
*Produit : 2026-06-07 | Tanjiro | Sprint 4 ClawBTP*
*Ref. architecturale : D-4-001, D-4-004, D-4-011, D-4-012, D-4-013*
*Périmètre : table `photos` (008) + job pg_cron (009) + bucket Supabase Storage `photos`*

Application manuelle via Supabase Dashboard SQL Editor et Supabase Dashboard Storage, cohérent avec les migrations 005/006/007. Ces trois opérations sont **indépendantes entre elles** mais doivent toutes être appliquées avant le deploy du code Sprint 4.

---

## Ordre d'application obligatoire

```
1. Migration 008 — table photos (SQL Editor)
2. Bucket Storage photos (Storage Dashboard)
3. Migration 009 — pg_cron job (SQL Editor) [conditionnel]
```

La migration 008 doit précéder le déploiement du code car les handlers `/api/photos` effectuent des INSERT/SELECT sur `public.photos`. La création du bucket doit précéder les uploads. La migration 009 est optionnelle (voir section dédiée).

---

## Prérequis communs

- Accès au projet Supabase ClawBTP (compte tpopulo@orkesyn.com)
- Migrations 006 et 007 appliquées en prod (vérifier section "Migrations appliquées en prod" de `memory/PROJECT_STATE.md`)
- URL SQL Editor : `https://supabase.com/dashboard/project/[PROJECT_ID]/sql`
- URL Storage : `https://supabase.com/dashboard/project/[PROJECT_ID]/storage/buckets`

---

## PARTIE 1 — Migration 008 : table `photos`

### Étape 0 — Audit état initial (avant migration)

Exécuter ces requêtes dans le SQL Editor. Aucune ne modifie la base.

**Requête 0a — Vérifier que la table n'existe PAS encore**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'photos';
```

Résultat attendu AVANT migration : **0 lignes**.
Si la requête retourne 1 ligne, la table existe déjà. Aller directement à l'étape 2 (vérifications post-migration).

**Requête 0b — Vérifier les tables de référence (FK)**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('taches', 'organisations', 'users');
```

Résultat attendu : **3 lignes**. Si l'une manque, les migrations antérieures ne sont pas complètes — ne pas continuer.

**Requête 0c — Vérifier la fonction `set_updated_at` (trigger)**

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'set_updated_at';
```

Résultat attendu : **1 ligne**. Cette fonction est créée par les migrations 001/002. Si absente, les migrations antérieures sont incomplètes.

---

### Étape 1 — Appliquer la migration 008

**1a.** Dans Supabase Dashboard, aller dans **SQL Editor** > **+ New query**.

**1b.** Copier-coller exactement le SQL suivant :

```sql
-- Migration 008 : table photos (upload ouvrier Sprint 4)
-- Fichier source : supabase/migrations/008_photos_upload.sql
-- Application : MANUELLE via Supabase Dashboard SQL editor (coherent 005/006/007).
-- Idempotente : IF NOT EXISTS sur table, index, trigger, policy.
-- Prerequis : migrations 006 + 007 appliquees. Bucket Storage 'photos' cree (voir Partie 2).

-- ============================================================
-- 1. Table photos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.photos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tache_id        uuid        NOT NULL REFERENCES taches(id) ON DELETE CASCADE,
  organisation_id uuid        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  uploader_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path    text        NOT NULL,
  commentaire     text        NULL CHECK (char_length(commentaire) <= 500),
  mime_type       text        NOT NULL CHECK (mime_type IN (
                                'image/jpeg', 'image/png', 'image/webp'
                              )),
  taille_octets   integer     NOT NULL CHECK (taille_octets > 0 AND taille_octets <= 10485760),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.photos IS
  'Photos uploadees par les ouvriers sur leurs taches (Sprint 4). '
  'storage_path = chemin bucket prive Supabase Storage. '
  'URLs : signed URLs TTL 1h generees a chaque affichage (PO-4-03, D-4-004). '
  'Hard delete + remove Storage best-effort (D-4-009). '
  'HEIC retire (D-056/PO-4-02 amende 2026-06-07 - whitelist stricte JPEG/PNG/WebP).';

COMMENT ON COLUMN public.photos.storage_path IS
  'Chemin dans bucket Supabase Storage (prive). '
  'Format : {organisation_id}/{tache_id}/{photo_id}.{ext}. '
  'NE JAMAIS exposer directement - utiliser les signed URLs (D-4-006).';

-- ============================================================
-- 2. Index
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_photos_tache_id
  ON public.photos(tache_id);

CREATE INDEX IF NOT EXISTS idx_photos_organisation_id
  ON public.photos(organisation_id);

CREATE INDEX IF NOT EXISTS idx_photos_uploader_id
  ON public.photos(uploader_id);

-- ============================================================
-- 3. Trigger updated_at
-- ============================================================
DROP TRIGGER IF EXISTS photos_set_updated_at ON public.photos;
CREATE TRIGGER photos_set_updated_at
  BEFORE UPDATE ON public.photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photos_org_isolation" ON public.photos;
CREATE POLICY "photos_org_isolation"
  ON public.photos
  FOR ALL
  TO authenticated
  USING (
    organisation_id = (
      (auth.jwt() -> 'app_metadata') ->> 'organisation_id'
    )::uuid
  );

-- ============================================================
-- 5. GRANTs (D-029 - Automatically expose new tables = OFF)
-- ============================================================
GRANT ALL ON public.photos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos TO authenticated;
```

**1c.** Cliquer sur **Run** (bouton vert ou Ctrl+Entrée).

Résultat attendu : `Success. No rows returned.`

---

### Étape 2 — Vérifications post-migration 008

**Requête 2a — La table existe**

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'photos';
```

Résultat attendu : **1 ligne**, `table_type = BASE TABLE`.

**Requête 2b — Les colonnes et contraintes**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'photos'
ORDER BY ordinal_position;
```

Résultat attendu : **10 colonnes** (id, tache_id, organisation_id, uploader_id, storage_path, commentaire, mime_type, taille_octets, created_at, updated_at).

**Requête 2c — Les index**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'photos'
ORDER BY indexname;
```

Résultat attendu : **4 lignes** (photos_pkey + idx_photos_organisation_id + idx_photos_tache_id + idx_photos_uploader_id).

**Requête 2d — La policy RLS**

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'photos';
```

Résultat attendu : **1 ligne**, policyname = `photos_org_isolation`.

**Requête 2e — RLS activée**

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname = 'photos';
```

Résultat attendu : `relrowsecurity = true`.

**Requête 2f — GRANTs**

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'photos'
ORDER BY grantee, privilege_type;
```

Résultat attendu : lignes pour `service_role` (ALL) et `authenticated` (SELECT, INSERT, UPDATE, DELETE).

---

### Rollback migration 008

A n'exécuter que si la table vient d'être créée et qu'aucune donnée n'a été insérée (Sprint 4 pas encore en prod).

**Vérifier avant rollback :**
```sql
SELECT COUNT(*) FROM public.photos;
```

Si = 0, tu peux rollback :

```sql
-- ROLLBACK MIGRATION 008
-- Condition : table photos vide ET code Sprint 4 non encore deploye
DROP TABLE IF EXISTS public.photos CASCADE;
```

`CASCADE` supprime automatiquement les index, triggers, policies et FK dépendantes.

**Impact code du rollback** :
- Tous les handlers `/api/photos` (POST, PATCH, DELETE) retourneront une erreur 500 (table inexistante).
- `GET /api/ouvrier/chantiers/[id]` échouerait sur le SELECT photos — le try/catch `42P01` du code S3 avait été retiré par Amelia (noté dans l'archi §3.8). Si le rollback est effectué avec le code S4 déployé, l'endpoint échoue.
- Conclusion : ne rollback que si le code Sprint 4 n'est pas encore déployé.

---

## PARTIE 2 — Création du bucket Storage `photos`

### Étape 3 — Créer le bucket via Supabase Dashboard

Le bucket ne peut pas être créé via SQL. Utiliser l'interface Storage.

**3a.** Dans Supabase Dashboard, aller dans **Storage** (menu gauche) > **Buckets** > **New bucket**.

**3b.** Renseigner les paramètres suivants :

| Paramètre | Valeur | Note |
|-----------|--------|------|
| Name | `photos` | Doit correspondre exactement au hardcode `.from('photos')` dans le code |
| Public bucket | **NON (décoché)** | Bucket privé — D-4-013 / PO-4-03 BINDING |
| File size limit | `10 MB` | D-4-005 : taille validée côté code ET Storage |
| Allowed MIME types | `image/jpeg, image/png, image/webp` | D-4-005 / PO-4-02 amende 2026-06-07 (HEIC retiré) |

**3c.** Cliquer sur **Create bucket**.

### Étape 4 — Vérifications post-bucket

**4a.** Le bucket `photos` apparaît dans la liste Supabase Dashboard > Storage > Buckets.

**4b.** Vérifier `Public` = **false** dans les détails du bucket (cliquer sur le bucket).

**4c.** Vérifier que les MIME types configurés correspondent à ceux du bucket (UI Supabase affiche la liste).

### RLS Storage — aucune policy ouvrier requise

L'ouvrier n'a pas de session Supabase Auth (D-054) : la RLS Storage Supabase est inopérante pour lui. Toutes les opérations Storage (upload, signed URLs, remove) passent par le service_role côté Route Handler — le service_role bypasse la RLS. Aucune policy Storage ouvrier ne doit être créée.

Pour conducteur/admin : la sécurité est assurée applicativement (re-validation JWT via `getUser()` côté handler, isolation `organisation_id` depuis JWT vérifié — D-4-014/D-4-019). Aucune RLS Storage conducteur n'est nécessaire en S4.

**Conclusion : aucune policy Storage à créer.** Le bucket doit rester sans policy (accès via service_role uniquement).

### Rollback bucket

Si le bucket `photos` doit être supprimé (avant tout upload) :

**Via Dashboard** : Storage > Buckets > `photos` > Delete bucket.

Si des fichiers existent déjà dans le bucket, les vider d'abord (Storage > `photos` > sélectionner tout > Delete). Un bucket non vide ne peut pas être supprimé.

---

## PARTIE 3 — Migration 009 : pg_cron (CONDITIONNELLE)

### Étape 5 — Vérifier la disponibilité de pg_cron

**AVANT d'appliquer la migration 009**, vérifier que l'extension pg_cron est disponible sur le projet Supabase eu-west.

**Option A — Via Supabase Dashboard :**
Aller dans **Database** > **Extensions**. Chercher `pg_cron`. Deux états possibles :
- Extension listée et **activée** (toggle vert) → pg_cron disponible, continuer avec étape 5b.
- Extension listée mais **désactivée** → activer via le toggle, puis continuer avec étape 5b.
- Extension **absente de la liste** → pg_cron non disponible sur ce plan Supabase. Aller à l'étape "Skip migration 009".

**Option B — Via SQL Editor :**

```sql
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'pg_cron';
```

Résultat : **1 ligne** = disponible. Résultat vide = pg_cron absent du plan.

Si pg_cron est disponible mais pas installé (`installed_version` = NULL) :
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Étape 5b — Appliquer la migration 009 (si pg_cron disponible)

**5b-1.** Vérifier que le job n'existe pas déjà :

```sql
SELECT jobname, schedule, command
FROM cron.job
WHERE jobname = 'cleanup-ouvrier-sessions-expires';
```

Résultat attendu AVANT migration : **0 lignes**.

**5b-2.** Appliquer la migration :

```sql
-- Migration 009 : pg_cron job cleanup sessions expirees (S4-F04, D-4-011)
-- Prerequis : extension pg_cron activee (Dashboard > Database > Extensions).

-- 1. Activer pg_cron si pas deja fait (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Supprimer le job si deja present (idempotent — re-play safe)
SELECT cron.unschedule('cleanup-ouvrier-sessions-expires')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-ouvrier-sessions-expires'
);

-- 3. Creer le job daily 03h00 UTC
SELECT cron.schedule(
  'cleanup-ouvrier-sessions-expires',
  '0 3 * * *',
  $$
    DELETE FROM public.ouvrier_sessions
    WHERE expires_at < NOW();
  $$
);
```

**5b-3.** Vérifier que le job est enregistré :

```sql
SELECT jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'cleanup-ouvrier-sessions-expires';
```

Résultat attendu :

| jobname | schedule | command | active |
|---------|----------|---------|--------|
| cleanup-ouvrier-sessions-expires | 0 3 * * * | DELETE FROM public.ouvrier_sessions WHERE expires_at < NOW(); | true |

**5b-4.** Vérifier que la table `cron.job_run_details` existe (confirme que pg_cron est opérationnel) :

```sql
SELECT COUNT(*) FROM cron.job_run_details LIMIT 1;
```

Résultat attendu : `0` (pas encore de runs) sans erreur.

### Rollback migration 009

```sql
-- ROLLBACK MIGRATION 009
SELECT cron.unschedule('cleanup-ouvrier-sessions-expires')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-ouvrier-sessions-expires'
);
```

Vérification : `SELECT * FROM cron.job WHERE jobname = 'cleanup-ouvrier-sessions-expires';` → 0 lignes.

**Impact du rollback** : le cleanup daily ne tourne plus. Les sessions expirées s'accumulent en base mais restent inactives (le lazy cleanup `WHERE expires_at > NOW()` dans `sessionStore.read` continue de les filtrer à chaque lecture). Aucun impact utilisateur.

### Étape 6 — Si pg_cron absent : skip et documenter

Si pg_cron n'est pas disponible sur le plan Supabase, ne pas appliquer la migration 009.

**Actions à effectuer en cas de skip :**

1. Dans `memory/PROJECT_STATE.md`, section "Dette tracée", ajouter :
   ```
   - pg_cron absent : migration 009 skippée Sprint 4. Seuil d'alerte : table ouvrier_sessions > 10 000 lignes
     (jamais atteint en pilote 60j). Cleanup lazy actif (WHERE expires_at > NOW() dans sessionStore.read).
     Action : vérifier disponibilité pg_cron à chaque upgrade plan Supabase.
   ```

2. Dans `artifacts/08-infra/SPRINT_4_INFRA_CHECKLIST.md`, cocher la case "Migration 009 : SKIPPÉE — pg_cron absent".

---

## Vérification de cohérence post-application (les 3 parties)

Exécuter ces 3 requêtes pour confirmer l'état complet avant le deploy du code Sprint 4 :

**Check global — toutes les tables Sprint 4 présentes**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('photos', 'ouvrier_sessions', 'taches', 'users', 'organisations', 'chantiers', 'affectations')
ORDER BY table_name;
```

Résultat attendu : **7 lignes**.

**Check bucket Storage**

Le bucket ne peut pas être vérifié via SQL. Confirmer visuellement dans Dashboard > Storage > Buckets que `photos` apparaît avec `Public = false`.

**Check pg_cron (si appliqué)**

```sql
SELECT jobname, active FROM cron.job WHERE jobname = 'cleanup-ouvrier-sessions-expires';
```

Résultat attendu : 1 ligne avec `active = true` (ou 0 lignes si migration 009 skippée — normal).

---

## Étape 7 — Documenter (obligatoire)

Après application réussie :

1. Dans `memory/PROJECT_STATE.md`, section "Migrations appliquées en prod", ajouter :
   - `Migration 008 (photos) : [x] appliquée YYYY-MM-DD`
   - `Bucket Storage photos (privé) : [x] créé YYYY-MM-DD`
   - `Migration 009 (pg_cron) : [x] appliquée YYYY-MM-DD` OU `[ ] SKIPPÉE — pg_cron absent`

2. Cocher les cases correspondantes dans `artifacts/08-infra/SPRINT_4_INFRA_CHECKLIST.md`.

---

## Troubleshooting

| Erreur | Cause probable | Action |
|--------|----------------|--------|
| `ERROR: relation "taches" does not exist` | Migrations antérieures non appliquées | Appliquer 001→007 dans l'ordre avant 008 |
| `ERROR: function public.set_updated_at() does not exist` | Migrations 001/002 non appliquées | Appliquer les migrations de base d'abord |
| `ERROR: relation "photos" already exists` | Migration 008 déjà appliquée — inoffensif si `IF NOT EXISTS` présent | Passer directement aux vérifications post-migration |
| `ERROR: schema "cron" does not exist` | pg_cron non activé | Activer via Dashboard > Database > Extensions ou skip migration 009 |
| Bucket `photos` ne peut pas être créé | Nom déjà pris ou plan Supabase Storage non activé | Vérifier dans Storage > Buckets ; contacter support Supabase si plan ne supporte pas Storage |
| Signed URLs retournent une erreur 400 depuis le code | Bucket name incorrect dans le code (`'photos'`) vs nom réel du bucket | Vérifier que le bucket s'appelle exactement `photos` (sensible à la casse) |
| `ERROR: permission denied for table photos` | Connexion `anon` ou `authenticated` sans service_role | Le SQL Editor Supabase Dashboard tourne en `postgres` (superuser) — pas de problème attendu |

---

## Référence SQL canonique

Les fichiers sources de vérité sont :
- `artifacts/07-code/supabase/migrations/008_photos_upload.sql`
- `artifacts/07-code/supabase/migrations/009_pg_cron_sessions_cleanup.sql`

Ce document reproduit leur contenu. En cas de divergence, les fichiers `.sql` font foi.
