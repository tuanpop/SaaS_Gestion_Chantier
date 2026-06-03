# Procédure d'application — Migration 007
*Produit : 2026-06-03 | Amelia | Sprint 3 finalisation ClawBTP*
*Ref. architecturale : D-054 | Pivot Redis → Postgres sessions ouvrier*

Migration 007 crée la table `ouvrier_sessions` qui remplace Redis pour les sessions ouvrier scan QR (D-054). Elle est idempotente (`IF NOT EXISTS`). Application manuelle via Supabase Dashboard SQL Editor, cohérent avec les migrations précédentes 005 et 006.

**BLOQUANT pre-deploy Sprint 3** : cette migration DOIT être appliquée avant le deploy. Sans elle, `sessionStore.create()` échoue au premier scan QR → redirect server_error.

---

## Prérequis

- Accès au projet Supabase ClawBTP (compte tpopulo@orkesyn.com ou invité Organisation)
- URL dashboard : https://supabase.com/dashboard/project/[PROJECT_ID]/sql
- Les migrations 001 à 006 DOIVENT être appliquées.

---

## Étape 0 — Audit état initial (avant migration)

Exécuter ces requêtes pour photographier l'état avant migration. Aucune ne modifie la base.

**Requête 0a — Vérifier que la table n'existe PAS encore**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'ouvrier_sessions';
```

Résultat attendu AVANT migration : **0 lignes**.
Si la requête retourne 1 ligne, la migration a déjà été appliquée. Skip à l'étape VÉRIF POST-MIGRATION.

**Requête 0b — Vérifier les tables existantes (références FK)**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('users', 'organisations');
```

Résultat attendu : **2 lignes** (les deux tables référencées par FK dans ouvrier_sessions).

---

## Étape 1 — Appliquer la migration

**1a.** Dans Supabase Dashboard, aller dans **SQL Editor** (menu gauche > SQL Editor > + New query).

**1b.** Copier-coller exactement le SQL suivant :

```sql
-- Migration 007 — Table ouvrier_sessions (D-054 pivot Redis → Postgres)
-- Sprint 3 finalisation — ClawBTP
-- Auteur : Amelia | Date : 2026-06-03
-- Application : MANUELLE via Supabase Dashboard SQL editor (pattern migration 005, D-007)
-- Idempotente : IF NOT EXISTS

CREATE TABLE IF NOT EXISTS public.ouvrier_sessions (
  session_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  data            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

COMMENT ON TABLE public.ouvrier_sessions IS
  'Sessions ouvrier scan QR Sprint 3 (D-054 pivot Redis → Postgres). Sliding window TTL 7j via UPDATE expires_at a chaque hit getOuvrierSession. Invalidation cascade DELETE WHERE user_id sur DELETE affectation (D-3-011). Cleanup lazy : WHERE expires_at > NOW() a chaque read.';

CREATE INDEX IF NOT EXISTS idx_ouvrier_sessions_user
  ON public.ouvrier_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_ouvrier_sessions_expires
  ON public.ouvrier_sessions(expires_at);

-- GRANTs manuels obligatoires (D-029 : "Automatically expose new tables" = OFF)
GRANT ALL ON public.ouvrier_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ouvrier_sessions TO authenticated;
```

**1c.** Cliquer sur **Run** (bouton vert ou Ctrl+Entrée).

Résultat attendu : `Success. No rows returned.`

---

## Étape 2 — Vérifications post-migration

**Requête 2a — La table existe**

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'ouvrier_sessions';
```

Résultat attendu : 1 ligne, `table_type = BASE TABLE`.

**Requête 2b — Les colonnes sont correctes**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ouvrier_sessions'
ORDER BY ordinal_position;
```

Résultat attendu : 6 colonnes — session_id (uuid, PK), user_id (uuid, NOT NULL), organisation_id (uuid, NOT NULL), data (jsonb, NOT NULL), created_at (timestamptz, NOT NULL, DEFAULT now()), expires_at (timestamptz, NOT NULL).

**Requête 2c — Les index existent**

```sql
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ouvrier_sessions';
```

Résultat attendu : au moins 3 lignes (PRIMARY KEY + idx_ouvrier_sessions_user + idx_ouvrier_sessions_expires).

**Requête 2d — Les GRANTs sont en place**

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'ouvrier_sessions'
ORDER BY grantee, privilege_type;
```

Résultat attendu : rows pour `service_role` (ALL) et `authenticated` (SELECT, INSERT, UPDATE, DELETE).

---

## Étape 3 — Documenter (obligatoire)

Après application réussie :

1. Dans `memory/PROJECT_STATE.md`, section "Infrastructure production" > "Migrations appliquées en prod", ajouter la ligne `Migration 007` et noter la date.
2. Dans `artifacts/08-infra/SPRINT_3_INFRA_CHECKLIST.md`, cocher la case "Migration 007 appliquée Supabase Dashboard".

---

## Rollback (si besoin)

À n'exécuter QUE si la migration a provoqué un problème inattendu ET qu'aucune session n'a encore été créée (table vide).

```sql
-- ROLLBACK MIGRATION 007
-- Vérifier que la table est vide avant rollback :
SELECT COUNT(*) FROM public.ouvrier_sessions;
-- Si = 0 :
DROP TABLE IF EXISTS public.ouvrier_sessions CASCADE;
```

**Impact code du rollback** : le scan QR ouvrier retournera redirect server_error jusqu'au redeploy avec Redis ou réapplication de la migration. Les autres fonctionnalités ne sont pas impactées.

---

## Troubleshooting

| Erreur | Cause probable | Action |
|--------|----------------|--------|
| `ERROR: relation "ouvrier_sessions" already exists` | Migration déjà appliquée | Inoffensif si `IF NOT EXISTS` est présent. Passer directement à VÉRIF POST-MIGRATION. |
| `ERROR: relation "users" does not exist` | Migrations 001-006 non appliquées | Appliquer les migrations antérieures dans l'ordre. |
| `ERROR: permission denied` | Connexion sans privilèges suffisants | Utiliser la connexion `postgres` (superuser) dans le SQL Editor Supabase Dashboard. |
| `ERROR: index already exists` | Index déjà créé (idempotent) | Inoffensif si `IF NOT EXISTS` est présent. |

---

## Référence SQL canonique (source)

Le fichier source de vérité est :
`artifacts/07-code/supabase/migrations/007_ouvrier_sessions.sql`

Ce document reproduit exactement son contenu. En cas de divergence, le fichier `.sql` fait foi.
