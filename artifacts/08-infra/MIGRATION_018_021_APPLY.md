# Procédure application migrations 018 → 021 — Sprint 8 Chat + Bot
*Produit : 2026-06-16 | Tanjiro | Sprint 8*
*Références : D-8-01, D-8-04, D-8-08, D-8-20, ADR-8-001, architecture-sprint-8.md §5*
*Prérequis : migrations 014→017 appliquées en prod (Sprint 6 + Sprint 7)*

---

## Contexte

Sprint 8 ajoute 4 migrations séquentielles, toutes manuelles via Supabase Dashboard SQL Editor.
**Aucun script automatisé, aucune modification du crontab supercronic, aucune variable d'env.**

| Migration | Contenu | Prérequis |
|-----------|---------|-----------|
| `018_chats_messages.sql` | Enum `message_type` + tables `chats` + `messages` + index + RLS + GRANTs | 001-017 appliquées |
| `019_action_proposals.sql` | Enums `action_type` + `action_proposal_statut` + table `action_proposals` + FK retour `messages.action_proposal_id` + extension enum `notification_type` (ADD VALUE isolés fin) | 018 appliquée |
| `020_claw_accueil_log.sql` | Table `claw_accueil_log` + index UNIQUE `uq_claw_accueil_user_date` + RLS service_role only + GRANTs | 019 appliquée |
| `021_pg_cron_purge_chat.sql` | 2 règles pg_cron conditionnelles : purge `messages > 90j` + purge `claw_accueil_log > 30j` | 020 appliquée |

---

## Étape 0 — Audit pré-migration (audit avant toute action)

Ouvrir Supabase Dashboard → SQL Editor, exécuter :

```sql
-- Vérifier les migrations déjà appliquées (018-021 ne doivent PAS exister)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('chats','messages','action_proposals','claw_accueil_log');
-- ATTENDU : 0 lignes (aucune de ces tables n'existe encore)

-- Vérifier que les prérequis Sprint 6+7 sont en place
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('derives_detectees','seuils_derives','briefings','meteo_cache');
-- ATTENDU : 4 lignes (toutes présentes)

-- Vérifier l'enum notification_type actuel (avant extension)
SELECT enum_range(NULL::notification_type);
-- ATTENDU : doit contenir au moins 'derive_proactive', 'briefing_lundi'
-- NE DOIT PAS contenir 'action_proposal' ou 'alerte_chat' (seront ajoutés par 019)

-- Vérifier pg_cron disponible (pour adapter 021)
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
-- Si 0 lignes : pg_cron absent — la migration 021 sera no-op (conditionnel IF EXISTS)
-- Si 1 ligne : pg_cron disponible — les règles seront créées

-- Vérifier les jobs pg_cron existants (pour éviter doublons 021)
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
-- Ne doivent PAS contenir 'purge-chat-messages' ou 'purge-claw-accueil'
-- (si oui : la migration 021 a déjà été appliquée partiellement — NE PAS réappliquer)
```

---

## Étape 1 — Migration 018 : `chats` + `messages`

**Fichier source** : `artifacts/07-code/supabase/migrations/018_chats_messages.sql`

Copier-coller l'intégralité du fichier dans le SQL Editor Supabase. Exécuter.

**Résultat attendu** : `Success. No rows returned.`

### Vérifications post-018

```sql
-- Tables créées
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('chats','messages');
-- ATTENDU : 2 lignes

-- Enum message_type créé
SELECT enum_range(NULL::message_type);
-- ATTENDU : {user,bot,system}

-- Contrainte UNIQUE sur chats.chantier_id
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'chats' AND indexname LIKE '%chantier%';
-- ATTENDU : 1 index UNIQUE sur chantier_id

-- RLS activé (chats)
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('chats','messages') AND schemaname = 'public';
-- ATTENDU : rowsecurity = true pour les deux

-- GRANTs : authenticated peut SELECT (pas INSERT/UPDATE/DELETE)
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'chats' AND grantee = 'authenticated';
-- ATTENDU : SELECT uniquement

-- Index performance messages
SELECT indexname FROM pg_indexes
WHERE tablename = 'messages'
  AND indexname IN ('idx_messages_chat_created','idx_messages_pending_bot');
-- ATTENDU : 2 lignes

-- Test idempotence : insérer un chantier_id fictif deux fois → le 2e doit violer UNIQUE
-- (NE PAS exécuter en prod — test en staging uniquement)
```

Cocher :
- [ ] Tables `chats` et `messages` créées
- [ ] Enum `message_type` = `{user,bot,system}`
- [ ] `chats.chantier_id` UNIQUE (empêche 2 chats / chantier)
- [ ] RLS activé sur `chats` et `messages`
- [ ] `authenticated` : SELECT seulement sur `chats` et `messages` (pas INSERT/UPDATE)
- [ ] Index `idx_messages_chat_created` et `idx_messages_pending_bot` présents
- [ ] Date d'application : ____________________

---

## Étape 2 — Migration 019 : `action_proposals` + enum extensions

**Fichier source** : `artifacts/07-code/supabase/migrations/019_action_proposals.sql`

**CRITIQUE — D-8-20 BINDING** : Cette migration contient des `ADD VALUE` pour l'enum `notification_type`.
Ils sont placés en **fin de migration dans deux blocs `DO $$ ... $$` séparés**.
Ne jamais insérer de notification de type `action_proposal` ou `alerte_chat` dans cette même migration.

Copier-coller l'intégralité du fichier dans le SQL Editor Supabase. Exécuter.

**Résultat attendu** : `Success. No rows returned.`

### Vérifications post-019

```sql
-- Table action_proposals créée
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'action_proposals';
-- ATTENDU : 1 ligne

-- Enums créés
SELECT enum_range(NULL::action_type);
-- ATTENDU : {creer_tache,ajouter_cr,replanifier,alerte}

SELECT enum_range(NULL::action_proposal_statut);
-- ATTENDU : {pending,valide,rejete,execute}

-- Enum notification_type étendu
SELECT enum_range(NULL::notification_type);
-- DOIT contenir : action_proposal ET alerte_chat (en plus des anciens)

-- FK retour messages.action_proposal_id ajoutée
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'messages' AND column_name = 'action_proposal_id';
-- ATTENDU : 1 ligne (uuid nullable)

-- Index partiel pending
SELECT indexname FROM pg_indexes
WHERE tablename = 'action_proposals'
  AND indexname = 'idx_action_proposals_chantier_pending';
-- ATTENDU : 1 ligne

-- RLS activé
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename = 'action_proposals' AND schemaname = 'public';
-- ATTENDU : rowsecurity = true

-- GRANTs : authenticated peut SELECT uniquement
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'action_proposals' AND grantee = 'authenticated';
-- ATTENDU : SELECT uniquement (pas INSERT/UPDATE/DELETE)

-- Vérifier que l'enum ADD VALUE n'a pas cassé notification_type
SELECT enum_range(NULL::notification_type);
-- DOIT toujours contenir : derive_proactive, briefing_lundi (rétrocompatibilité)
-- + action_proposal, alerte_chat (nouveaux)
```

Cocher :
- [ ] Table `action_proposals` créée
- [ ] Enum `action_type` = `{creer_tache,ajouter_cr,replanifier,alerte}`
- [ ] Enum `action_proposal_statut` = `{pending,valide,rejete,execute}`
- [ ] `notification_type` contient `action_proposal` ET `alerte_chat`
- [ ] `notification_type` contient toujours `derive_proactive` et `briefing_lundi` (rétro)
- [ ] `messages.action_proposal_id` ajoutée (nullable FK)
- [ ] Index `idx_action_proposals_chantier_pending` présent
- [ ] RLS activé sur `action_proposals`
- [ ] `authenticated` : SELECT seulement sur `action_proposals`
- [ ] Date d'application : ____________________

---

## Étape 3 — Migration 020 : `claw_accueil_log`

**Fichier source** : `artifacts/07-code/supabase/migrations/020_claw_accueil_log.sql`

Copier-coller l'intégralité du fichier dans le SQL Editor Supabase. Exécuter.

**Résultat attendu** : `Success. No rows returned.`

### Vérifications post-020

```sql
-- Table créée
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'claw_accueil_log';
-- ATTENDU : 1 ligne

-- Index UNIQUE idempotence
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'claw_accueil_log' AND indexname = 'uq_claw_accueil_user_date';
-- ATTENDU : 1 ligne (UNIQUE sur user_id + date_accueil)

-- RLS : FOR ALL USING(false) — aucune lecture/écriture authenticated
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename = 'claw_accueil_log' AND schemaname = 'public';
-- ATTENDU : rowsecurity = true

-- Vérifier absence de GRANT authenticated (table technique service_role only — D-8-04)
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'claw_accueil_log' AND grantee = 'authenticated';
-- ATTENDU : 0 lignes (aucun GRANT authenticated)

-- Test : SELECT authenticated sur claw_accueil_log doit être refusé par RLS
-- (test via client non-service_role — si disponible en staging)

-- CHECK contenu <= 1000
SELECT check_clause FROM information_schema.check_constraints
WHERE constraint_name LIKE '%claw_accueil%';
-- ATTENDU : contient char_length(contenu) <= 1000
```

Cocher :
- [ ] Table `claw_accueil_log` créée
- [ ] Index UNIQUE `uq_claw_accueil_user_date` présent (sur `user_id` + `date_accueil`)
- [ ] RLS activé, FOR ALL USING(false) — authenticated ne peut ni lire ni écrire
- [ ] Aucun GRANT `authenticated` sur cette table
- [ ] CHECK `contenu <= 1000 chars` présent
- [ ] FKs `user_id`, `organisation_id`, `chantier_id` ON DELETE CASCADE présentes
- [ ] Date d'application : ____________________

---

## Étape 4 — Migration 021 : pg_cron purges (conditionnel)

**Fichier source** : `artifacts/07-code/supabase/migrations/021_pg_cron_purge_chat.sql`

**Note** : Cette migration est **conditionnelle** (pattern Sprint 4 migration 009).
Si `pg_cron` est absent de l'instance Supabase, les blocs `DO $$` sont des no-ops silencieux.
Si `pg_cron` est présent, deux jobs sont créés uniquement s'ils n'existent pas déjà.

Copier-coller l'intégralité du fichier dans le SQL Editor Supabase. Exécuter.

**Résultat attendu** : `Success. No rows returned.` (que pg_cron soit présent ou non)

### Vérifications post-021

```sql
-- Cas 1 : pg_cron présent
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
-- Si 1 ligne → vérifier que les jobs ont bien été créés :

SELECT jobname, schedule, command, active
FROM cron.job
WHERE jobname IN ('purge-chat-messages','purge-claw-accueil')
ORDER BY jobname;
-- ATTENDU (si pg_cron présent) :
-- purge-chat-messages | 0 3 * * 0 | DELETE FROM messages WHERE created_at < NOW() - INTERVAL '90 days' | true
-- purge-claw-accueil  | 0 3 * * 0 | DELETE FROM claw_accueil_log WHERE created_at < NOW() - INTERVAL '30 days' | true

-- Cas 2 : pg_cron absent
-- Pas de job créé — comportement attendu (purge manuelle à prévoir si nécessaire)
-- La purge pg_cron est SQL-pur, PAS dans le crontab supercronic (D-8-08 BINDING)

-- Vérifier idempotence : réexécuter la migration 021 → toujours 0 erreur (NOT EXISTS condition)
```

Cocher :
- [ ] Migration 021 exécutée sans erreur
- [ ] Si pg_cron présent : jobs `purge-chat-messages` et `purge-claw-accueil` créés (schedule `0 3 * * 0`)
- [ ] Si pg_cron absent : migration no-op silencieuse — documenté ici : ____________________
- [ ] La purge est SQL-pur (pg_cron) et NON dans le crontab supercronic (confirmer : crontab non modifié)
- [ ] Date d'application : ____________________

---

## Ordre complet global (toutes migrations depuis prod 001-013)

```
014 → 015 → 016 → 017 → 018 → 019 → 020 → 021
```

Si certaines migrations Sprint 6/7 sont déjà appliquées, reprendre à la première manquante.
Vérification rapide de l'état actuel :

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'derives_detectees',  -- 014
    'seuils_derives',     -- 015
    'briefings',          -- 016
    'meteo_cache',        -- 017
    'chats',              -- 018
    'messages',           -- 018
    'action_proposals',   -- 019
    'claw_accueil_log'    -- 020
  )
ORDER BY table_name;
-- Comparer avec les tables attendues à chaque étape
```

---

## Rollback migrations Sprint 8

**Politique** : les migrations Sprint 8 peuvent être rollbackées si le code n'est pas encore déployé.
Si le code Sprint 8 est en prod, rollback code d'abord (Dokploy), puis rollback migrations.

### Rollback 021 (pg_cron purges)

```sql
-- Supprimer les jobs pg_cron Sprint 8 (si pg_cron présent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-chat-messages');
    PERFORM cron.unschedule('purge-claw-accueil');
  END IF;
END $$;
```

### Rollback 020 (claw_accueil_log)

```sql
DROP TABLE IF EXISTS claw_accueil_log CASCADE;
```

### Rollback 019 (action_proposals + enum extensions)

```sql
-- Retirer la FK messages.action_proposal_id
ALTER TABLE messages DROP COLUMN IF EXISTS action_proposal_id;

-- Supprimer la table
DROP TABLE IF EXISTS action_proposals CASCADE;

-- Supprimer les enums
DROP TYPE IF EXISTS action_proposal_statut;
DROP TYPE IF EXISTS action_type;

-- ATTENTION : retirer une valeur d'enum PostgreSQL n'est PAS possible en standard
-- 'action_proposal' et 'alerte_chat' resteront dans notification_type
-- Ce n'est pas bloquant (le code Sprint 8 revert ne les utilise plus)
-- Cleanup possible uniquement par recréation de l'enum (avec contrainte de migration complète)
```

### Rollback 018 (chats + messages)

```sql
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS chats CASCADE;
DROP TYPE IF EXISTS message_type;
```

**Note** : rollback dans l'ordre inverse (021 → 020 → 019 → 018). Ne jamais rollback 014-017.
