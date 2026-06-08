# Procédure d'application — Migration 010 : système de notifications
*Produit : 2026-06-08 | Tanjiro | Sprint 4 "Visibilité Dirigeant" — ClawBTP*
*Ref. architecturale : D-4V-001, D-4V-007, D-4V-008, D-4V-014, D-4V-019*
*Périmètre : enum `notification_type`, table `notifications`, 3 index, 3 policies RLS, GRANTs, function `sql_html_escape`, function `notif_jalons_cron`, 2 jobs pg_cron (jalons 06h + purge 90j)*

Application manuelle via Supabase Dashboard SQL Editor, cohérente avec les migrations 005–009.
**Ne pas appliquer en production sans avoir lu ce document en entier.**

---

## Ordre de déploiement global Sprint 4 — Visibilité

```
Migration 008   (table photos)           — terrain
Migration 009   (pg_cron sessions)       — terrain, conditionnel
Bucket Storage  (photos, privé)          — terrain
↓
Migration 010   (notifications)          — visibilité ← CE DOCUMENT
↓
Deploy code     (branche sprint-4/completion-terrain → main → Dokploy)
```

**La migration 010 est indépendante des migrations 008 et 009.** Elle ne référence ni la table `photos` ni la table `ouvrier_sessions`. L'ordre ci-dessus est l'ordre opérationnel recommandé pour appliquer toutes les migrations Sprint 4 en un seul épisode de maintenance, mais 010 peut être appliquée avant ou après 008/009 sans impact.

**Prérequis réels pour la migration 010** : migrations 001–007 appliquées (tables `organisations`, `users`, `chantiers`, `taches`, `affectations` présentes). Les migrations 008 et 009 ne sont pas prérequises.

---

## Variables d'environnement

**Aucune nouvelle variable d'environnement requise.** Confirmation basée sur la lecture de `lib/notifications/notif.ts` : le helper utilise `createAdminClient()` qui réutilise `SUPABASE_SERVICE_ROLE_KEY` et `NEXT_PUBLIC_SUPABASE_URL` déjà présentes en prod (identiques aux migrations Sprint 3 et Sprint 4 terrain).

Les 4 endpoints `/api/notifications/*` lisent les claims via headers middleware (`x-user-id`, `x-organisation-id`, `x-user-role`) — aucune variable d'environnement supplémentaire.

**Variables prod existantes à vérifier (inchangées depuis Sprint 3) :**

| Variable | Localisation Dokploy | Note |
|----------|---------------------|------|
| `SUPABASE_SERVICE_ROLE_KEY` | Environment uniquement (jamais Build-time, jamais `NEXT_PUBLIC_`) | Requise pour `adminClient` |
| `NEXT_PUBLIC_SUPABASE_URL` | Environment + Build-time Arguments | Inchangée |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Environment + Build-time Arguments | Inchangée |

---

## Prérequis

**Requête 0a — Vérifier que les tables de référence existent (FK)**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('organisations', 'users', 'chantiers', 'taches');
```

Résultat attendu : **4 lignes**. Si l'une manque, les migrations antérieures sont incomplètes — ne pas continuer.

**Requête 0b — Vérifier que la table `notifications` n'existe PAS encore**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'notifications';
```

Résultat attendu AVANT migration : **0 lignes**.
Si la requête retourne 1 ligne, la table existe déjà — aller directement à l'étape 2 (vérifications post-migration). La migration est idempotente et peut être relancée sans risque.

**Requête 0c — Vérifier que l'enum `notification_type` n'existe PAS encore**

```sql
SELECT typname
FROM pg_type
WHERE typname = 'notification_type'
  AND typnamespace = 'public'::regnamespace;
```

Résultat attendu AVANT migration : **0 lignes**. Si 1 ligne est retournée, l'enum existe déjà (le bloc `DO $$ ... WHEN duplicate_object THEN NULL` le gérera sans erreur).

---

## Étape 1 — Appliquer la migration 010

**1a.** Dans Supabase Dashboard, aller dans **SQL Editor** > **+ New query**.

**1b.** Copier-coller exactement le contenu du fichier source :
`artifacts/07-code/supabase/migrations/010_notifications.sql`

Ce fichier est la référence canonique. Ne pas recopier le SQL ici pour éviter toute divergence.

**1c.** Cliquer sur **Run** (bouton vert ou Ctrl+Entrée).

Résultat attendu : `Success. No rows returned.`

**Si pg_cron n'est pas disponible** : la migration reste valide — les deux blocs `DO $$` de planification cron émettront un WARNING plutôt qu'une erreur (`WHEN undefined_function THEN RAISE WARNING`). Voir section "pg_cron — procédure de vérification et skip" ci-dessous.

---

## Étape 2 — Vérifications post-migration

### 2a — La table existe

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'notifications';
```

Résultat attendu : **1 ligne**, `table_type = BASE TABLE`.

### 2b — L'enum existe avec les 6 valeurs exactes

```sql
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = (
  SELECT oid FROM pg_type
  WHERE typname = 'notification_type'
    AND typnamespace = 'public'::regnamespace
)
ORDER BY enumsortorder;
```

Résultat attendu : **6 lignes** dans cet ordre :

| enumlabel |
|-----------|
| affectation_tache |
| tache_terminee |
| tache_bloquee |
| derive_budget |
| echeance_chantier |
| echeance_tache |

### 2c — Les colonnes

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'notifications'
ORDER BY ordinal_position;
```

Résultat attendu : **12 colonnes** (id, organisation_id, user_id, type, titre, message, chantier_id, tache_id, lu, read_at, created_at).

Vérifications clés :
- `lu` : `boolean`, NOT NULL, `default false`
- `read_at` : nullable (YES)
- `chantier_id` : nullable (YES)
- `tache_id` : nullable (YES)

### 2d — Les 3 index

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'notifications'
ORDER BY indexname;
```

Résultat attendu : **4 lignes** (notifications_pkey + les 3 index applicatifs) :

| indexname | présence |
|-----------|----------|
| `notifications_pkey` | clé primaire uuid |
| `idx_notifications_org_created` | ON (organisation_id, created_at) |
| `idx_notifications_type_ref` | ON (user_id, type, chantier_id, tache_id) WHERE lu = false |
| `idx_notifications_user_lu_created` | ON (user_id, lu, created_at DESC) |

### 2e — RLS activée

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname = 'notifications';
```

Résultat attendu : `relrowsecurity = true`.

### 2f — Les 3 policies RLS

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'notifications'
ORDER BY policyname;
```

Résultat attendu : **3 lignes** :

| policyname | cmd |
|------------|-----|
| `notifications_insert_service_role_only` | INSERT |
| `notifications_select_own_org` | SELECT |
| `notifications_update_own` | UPDATE |

Point de contrôle critique : la policy `notifications_insert_service_role_only` doit avoir `with_check = false` (bloque tout INSERT par `authenticated`).

### 2g — GRANTs

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'notifications'
ORDER BY grantee, privilege_type;
```

Résultat attendu :
- `service_role` : DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE (ALL)
- `authenticated` : SELECT, UPDATE uniquement (**PAS INSERT, PAS DELETE**)

### 2h — Function `sql_html_escape`

```sql
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'sql_html_escape';
```

Résultat attendu : **1 ligne**, `routine_type = FUNCTION`, `security_type = INVOKER` (IMMUTABLE STRICT — pas SECURITY DEFINER ici).

Vérification fonctionnelle :

```sql
SELECT public.sql_html_escape('Test <script>alert("xss")</script> & "guillemets" & ''apostrophe''');
```

Résultat attendu (ordre de substitution impératif — & en premier) :
`Test &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;guillemets&quot; &amp; &#39;apostrophe&#39;`

### 2i — Function `notif_jalons_cron`

```sql
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'notif_jalons_cron';
```

Résultat attendu : **1 ligne**, `routine_type = FUNCTION`, `security_type = DEFINER` (SECURITY DEFINER — s'exécute avec les privilèges du propriétaire postgres).

---

## pg_cron — procédure de vérification et skip

Cette procédure est identique à celle étudiée pour la migration 009 (référence : `MIGRATION_008_009_APPLY.md` section "Partie 3"). Elle est reproduite ici pour autonomie de ce document.

### Étape 3a — Vérifier la disponibilité de pg_cron

**Option A — Via Supabase Dashboard :**
Aller dans **Database** > **Extensions**. Chercher `pg_cron`. Trois états possibles :
- Extension listée et **activée** (toggle vert) → pg_cron disponible, continuer avec étape 3b.
- Extension listée mais **désactivée** → activer via le toggle, puis continuer avec étape 3b.
- Extension **absente de la liste** → pg_cron non disponible sur ce plan Supabase. Aller à la section "skip".

**Option B — Via SQL Editor :**

```sql
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'pg_cron';
```

Résultat : **1 ligne** = disponible (même si `installed_version` est NULL). Résultat vide = pg_cron absent du plan.

Si pg_cron est listé mais non installé (`installed_version` = NULL) :

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Étape 3b — Vérifier les jobs cron après migration 010

Si pg_cron est disponible, la migration 010 a déjà planifié les 2 jobs lors du `Run` de l'étape 1. Vérifier :

```sql
SELECT jobname, schedule, command, active
FROM cron.job
WHERE jobname IN ('notif-jalons-depassees', 'notif-purge-retention-90j')
ORDER BY jobname;
```

Résultat attendu : **2 lignes** :

| jobname | schedule | active |
|---------|----------|--------|
| `notif-jalons-depassees` | `0 6 * * *` | true |
| `notif-purge-retention-90j` | `0 4 * * 0` | true |

Vérification : la table `cron.job_run_details` est accessible (confirme pg_cron opérationnel) :

```sql
SELECT COUNT(*) FROM cron.job_run_details;
```

Résultat attendu : `0` ou N (pas d'erreur).

### Si les jobs sont absents après migration (pg_cron activé après coup)

Si pg_cron n'était pas activé lors du Run de la migration, activer l'extension puis relancer les blocs de planification manuellement :

```sql
-- Réplanification manuelle du job jalons (idempotent — unschedule avant schedule)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notif-jalons-depassees') THEN
    PERFORM cron.unschedule('notif-jalons-depassees');
  END IF;
  PERFORM cron.schedule(
    'notif-jalons-depassees',
    '0 6 * * *',
    $cron$ SELECT public.notif_jalons_cron(); $cron$
  );
EXCEPTION
  WHEN undefined_function THEN
    RAISE WARNING 'pg_cron non disponible.';
  WHEN undefined_table THEN
    RAISE WARNING 'pg_cron non disponible.';
END $$;

-- Réplanification manuelle du job purge rétention 90j
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notif-purge-retention-90j') THEN
    PERFORM cron.unschedule('notif-purge-retention-90j');
  END IF;
  PERFORM cron.schedule(
    'notif-purge-retention-90j',
    '0 4 * * 0',
    $cron$ DELETE FROM public.notifications WHERE created_at < NOW() - INTERVAL '90 days'; $cron$
  );
EXCEPTION
  WHEN undefined_function THEN
    RAISE WARNING 'pg_cron non disponible.';
  WHEN undefined_table THEN
    RAISE WARNING 'pg_cron non disponible.';
END $$;
```

### Étape 3c — Simulation manuelle du cron jalons (optionnel — vérification fonctionnelle)

Pour valider la function sans attendre 06h00 UTC :

```sql
-- Exécuter manuellement le job jalons
SELECT public.notif_jalons_cron();
```

Résultat attendu : pas d'erreur (`void`). Si des chantiers actifs ont `date_fin_prevue < CURRENT_DATE` ou des tâches avec `date_echeance < CURRENT_DATE`, des lignes seront insérées dans `notifications`. Vérifier :

```sql
SELECT type, titre, created_at
FROM public.notifications
ORDER BY created_at DESC
LIMIT 10;
```

Un second appel immédiat ne doit pas insérer de doublons (idempotence `NOT EXISTS lu=false`) :

```sql
SELECT public.notif_jalons_cron();
SELECT COUNT(*) FROM public.notifications;  -- count identique au premier run
```

### Skip pg_cron — procédure

Si pg_cron n'est pas disponible sur le plan Supabase, la migration 010 reste valide dans son ensemble. Seuls les 2 jobs de planification sont ignorés (les blocs `DO $$` émettent des WARNING, pas des erreurs).

**Impact fonctionnel d'un skip pg_cron :**
- La table `notifications`, les policies RLS, les GRANTs, les functions `sql_html_escape` et `notif_jalons_cron` sont tous créés et opérationnels.
- Les 4 types d'événements event-based (`affectation_tache`, `tache_terminee`, `tache_bloquee`, `derive_budget`) fonctionnent entièrement sans cron — ils sont déclenchés de façon synchrone par les Route Handlers.
- Seuls les 2 types date-based (`echeance_chantier`, `echeance_tache`) ne seront pas générés tant que pg_cron n'est pas activé. Ce sont les alertes jalons dépassés (Événement 4a/4b).

**Actions en cas de skip :**

1. Dans `memory/PROJECT_STATE.md`, section "Dette tracée", ajouter :
   ```
   - pg_cron absent : migration 010 jobs cron skippés Sprint 4 Visibilité.
     Impact : notifs date-based (echeance_chantier, echeance_tache) non générées.
     Les 4 événements event-based (affectation, statut, dérive budget) fonctionnent normalement.
     Action : activer pg_cron via Dashboard Extensions à chaque upgrade plan Supabase,
     puis relancer les blocs DO $$ de planification (voir MIGRATION_010_APPLY.md §3b).
   ```

2. Dans `artifacts/08-infra/SPRINT_4_INFRA_CHECKLIST.md` (à créer pour Sprint Visibilité), cocher "Migration 010 pg_cron : SKIPPÉE — pg_cron absent, jobs jalons non planifiés, dette tracée".

---

## Étape 4 — Vérification globale post-migration 010

**Check global — toutes les tables Sprint 4 présentes**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'notifications', 'photos', 'ouvrier_sessions',
    'taches', 'users', 'organisations', 'chantiers', 'affectations'
  )
ORDER BY table_name;
```

Résultat attendu : **8 lignes** (si 008 + 010 appliquées). 7 lignes si 008 n'est pas encore appliquée (normal si 010 appliquée avant 008 — indépendantes).

**Check jobs cron (si pg_cron disponible)**

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'cleanup-ouvrier-sessions-expires',
  'notif-jalons-depassees',
  'notif-purge-retention-90j'
)
ORDER BY jobname;
```

Résultat attendu avec migrations 009 + 010 appliquées : **3 lignes**, toutes `active = true`.

---

## Rollback migration 010

**Vérifier avant rollback :**

```sql
SELECT COUNT(*) FROM public.notifications;
```

Si = 0 (aucune notification encore créée, Sprint Visibilité pas encore déployé) :

```sql
-- ROLLBACK MIGRATION 010
-- Condition : table notifications vide ET code Sprint 4 Visibilité non encore déployé

-- 1. Supprimer les jobs pg_cron s'ils existent
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notif-jalons-depassees') THEN
    PERFORM cron.unschedule('notif-jalons-depassees');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notif-purge-retention-90j') THEN
    PERFORM cron.unschedule('notif-purge-retention-90j');
  END IF;
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

-- 2. Supprimer les functions
DROP FUNCTION IF EXISTS public.notif_jalons_cron();
DROP FUNCTION IF EXISTS public.sql_html_escape(text);

-- 3. Supprimer la table (CASCADE supprime index, policies, FK dépendantes)
DROP TABLE IF EXISTS public.notifications CASCADE;

-- 4. Supprimer l'enum
DROP TYPE IF EXISTS public.notification_type;
```

Vérification post-rollback :

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'notifications';
-- Attendu : 0 lignes

SELECT typname FROM pg_type
WHERE typname = 'notification_type' AND typnamespace = 'public'::regnamespace;
-- Attendu : 0 lignes
```

**Impact code du rollback :**
- `lib/notifications/notif.ts` : tous les appels à `insertNotification()` retourneront silencieusement une erreur (best-effort — aucun crash des Route Handlers appelants).
- Les 4 endpoints `/api/notifications/*` retourneront 500 (table absente).
- `components/notifications/NotificationBell.tsx` : le polling `GET /api/notifications/unread-count` retournera 500 → le badge affichera 0 (comportement gracieux si le composant gère l'erreur).
- **Conclusion** : rollback uniquement si le code Sprint Visibilité n'est pas encore déployé.

---

## Troubleshooting

| Erreur | Cause probable | Action |
|--------|----------------|--------|
| `ERROR: relation "organisations" does not exist` | Migrations 001–007 non appliquées | Appliquer dans l'ordre avant 010 |
| `ERROR: type "notification_type" already exists` | Idempotence — inoffensif si bloc `duplicate_object` présent | Le bloc DO $$ gère l'exception, pas d'action |
| `ERROR: relation "notifications" already exists` | Migration 010 déjà appliquée | Passer directement aux vérifications post-migration |
| `WARNING: pg_cron non disponible — schedule ... ignoré` | pg_cron absent du plan Supabase | Normal en cas de skip — voir section "Skip pg_cron" |
| `ERROR: schema "cron" does not exist` | pg_cron non activé alors que les blocs cron sont exécutés hors du bloc conditionnel | Vérifier que c'est bien le SQL de 010_notifications.sql qui est exécuté (blocs DO $$ conditionnels) |
| `ERROR: permission denied for table notifications` | Connexion `anon` ou `authenticated` sans service_role | Le SQL Editor Supabase Dashboard tourne en `postgres` (superuser) — pas de problème attendu |
| `count()` sur `cron.job` retourne 0 après migration | pg_cron activé après le Run — jobs non planifiés | Relancer les blocs DO $$ de réplanification (voir §3b) |

---

## Findings pour Itachi (quality gate)

Les items suivants sont des observations factuelles relevées lors de la production de cet artifact. Ils ne bloquent pas la migration mais doivent être évalués par Itachi.

**FINDING-INF-01 (informationnel) — SECURITY DEFINER owner documentation**

La function `notif_jalons_cron()` est `SECURITY DEFINER`. Le commentaire SQL du fichier 010 note : "Owner attendu : rôle postgres (superuser Supabase hosted)". Ce rôle est le rôle propriétaire par défaut sur Supabase — la function s'exécutera donc avec les droits de `postgres`. Ce rôle peut écrire dans `public.notifications` sans passer par la RLS (service_role et postgres bypasses RLS). Comportement attendu et documenté (D-4V-007). Pas d'action requise, mais Kakashi devrait confirmer que ce comportement est acceptable dans le contexte du threat-model (§7.7 injection SQL).

**FINDING-INF-02 (informationnel) — `cast as unknown as any` dans les handlers notifications**

Le pattern `(adminClient as unknown as any).from('notifications')` est présent dans `insertNotification()` et les 4 Route Handlers. Ce cast est documenté comme "Pattern Bug A Zoro" dans le code source : la table `notifications` n'est pas encore dans `types/database.ts` générés automatiquement (D-019 : types étendus manuellement). Ce pattern est cohérent avec l'approche existante du projet. Pas de risque sécurité : le filtre `organisation_id` + `user_id` est appliqué explicitement à chaque query. Pas d'action requise pour la migration 010, mais un `supabase gen types` après application de 010 en prod permettrait de retirer ces casts.

**FINDING-INF-03 (informationnel) — Purge cron DELETE sans filtre organisation_id**

Le job `notif-purge-retention-90j` exécute `DELETE FROM public.notifications WHERE created_at < NOW() - INTERVAL '90 days'` sans filtre `organisation_id`. Ce comportement est correct et intentionnel : la rétention 90j s'applique à toutes les organisations de façon uniforme (PO-4V-04 = B). L'index `idx_notifications_org_created` accélère ce DELETE. Pas d'action requise.

---

## Étape 5 — Documenter (obligatoire)

Après application réussie :

1. Dans `memory/PROJECT_STATE.md`, section "Migrations appliquées prod", ajouter :
   ```
   Migration 010 (notifications) : [x] appliquée YYYY-MM-DD
   pg_cron jalons + purge Sprint Visibilité : [x] planifiés YYYY-MM-DD
                                          OU : [ ] SKIPPÉS — pg_cron absent (dette tracée)
   ```

2. Dans `artifacts/08-infra/SPRINT_4_INFRA_CHECKLIST.md`, cocher les cases correspondantes.

---

## Référence SQL canonique

Le fichier source de vérité est :
`artifacts/07-code/supabase/migrations/010_notifications.sql`

En cas de divergence entre ce guide et le fichier `.sql`, le fichier `.sql` fait foi.
