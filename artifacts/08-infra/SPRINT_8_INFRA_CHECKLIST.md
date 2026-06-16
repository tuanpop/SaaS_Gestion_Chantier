# Checklist infra Sprint 8 — ClawBTP Chat d'équipe + Bot extracteur d'actions
*Produit : 2026-06-16 | Tanjiro | Sprint 8*
*Références binding : D-8-01, D-8-04, D-8-08, D-8-11, D-8-16, D-8-20, ADR-8-001, V-8-XX*
*Procédure migrations détaillée : `artifacts/08-infra/MIGRATION_018_021_APPLY.md`*

---

## Résumé Sprint 8 côté infra

| Changement | Nature | Impact infra |
|------------|--------|-------------|
| Migrations 018-021 | 4 SQL manuels Supabase Dashboard | Séquentielles — voir MIGRATION_018_021_APPLY.md |
| Variables d'env | **AUCUNE nouvelle variable** | ANTHROPIC_API_KEY + CRON_SECRET suffisent |
| Crontab supercronic | **NON modifié** | Le pipeline bot est déclenché par POST message, pas un cron |
| pg_cron (migration 021) | 2 règles purge ajoutées côté DB | SQL-pur, PAS dans le crontab supercronic |
| Dockerfile / images | **NON modifiés** | Sprint 8 est un amendement applicatif pur |
| `replicas` service app | **Vigilance** : voir §Contrainte fire-and-forget ci-dessous | Pas de changement de valeur mais implication documentée |

**Sprint 8 = zéro nouvelle dépendance npm, zéro nouvelle variable d'env, zéro nouvelle ligne crontab.**
Tout repose sur les briques existantes.

---

## Contrainte fire-and-forget / replicas — POINT DE VIGILANCE DÉPLOIEMENT

**Contexte (ADR-8-001 / D-8-11)** : le pipeline bot `void lancerPipelineBot(message, adminClient)`
est exécuté en fire-and-forget dans le process Node du handler POST message. Il n'y a pas de queue.

**Implication avec replicas > 1** :

Le `docker-compose.yml` actuel a `replicas: 2` pour le service `app`. Chaque POST message
atterrit sur un des deux replicas. Le pipeline fire-and-forget s'exécute dans ce replica spécifique.

Ce pattern est **acceptable et documenté** sous la sémantique **at-most-once** (ADR-8-001) :

- Si le replica reçoit le POST et termine le pipeline avant la prochaine rotation → pipeline exécuté.
- Si le replica redémarre entre le 201 et la fin du pipeline → pipeline perdu silencieusement
  (le message humain est persisté, seul le traitement bot est perdu).
- Avec `replicas: 2` et `update_config.parallelism: 1`, la probabilité de perdre un pipeline
  en production courante est très faible (restart = condition exceptionnelle).

**Conséquence opérationnelle** :
- La **garantie at-most-once** s'applique : un message peut ne pas déclencher de proposition bot
  si le replica redémarre exactement pendant le pipeline (fenêtre de quelques secondes).
- L'impact métier est minimal : le message est visible dans le fil, le conducteur peut créer une
  tâche manuellement si besoin.
- La sémantique "at-most-once" (vs "at-least-once" avec queue) est un **choix délibéré**
  de l'architecture Sprint 8 (pas d'over-engineering pour le volume pilote).

**Aucune modification de `replicas` n'est requise ni recommandée pour Sprint 8.**

Si le PO exige une garantie "at-least-once" : passer par une queue (BullMQ ou table `jobs` +
worker) — évolution V2 documentée dans architecture-sprint-8.md §11.

---

## Phase A — Pré-deploy (AVANT le merge)

### A1 — Confirmation variables d'environnement Dokploy (aucune nouvelle Sprint 8)

Sprint 8 ne requiert **aucune nouvelle variable d'environnement**.

| Variable | Usage Sprint 8 | Où confirmer | Attendu |
|----------|---------------|--------------|---------|
| `ANTHROPIC_API_KEY` | Pipeline bot Haiku (tri intention) + Sonnet (extraction/@claw) + accueil Claw Haiku — via `ILLMClient`, même clé | Dokploy > service > Environment | Présente (ajoutée Sprint 5) |
| `CRON_SECRET` | Crons existants (derives, briefing, etc.) — aucun nouveau cron Sprint 8 | Dokploy > service > Environment | Présent (ajouté Sprint 4) |
| `OPENWEATHER_API_KEY` | Lecture seule via `meteo_cache` (Sprint 7) — accueil Claw réutilise le cache, zéro appel OpenWeather direct | Dokploy > service > Environment | Présente (ajoutée Sprint 7) |

Checklist :
- [ ] `ANTHROPIC_API_KEY` présente et non vide — **ne pas modifier** (même clé pour Haiku + Sonnet via `model?` D-7-11)
- [ ] `CRON_SECRET` présent — **ne pas modifier**
- [ ] `OPENWEATHER_API_KEY` présente — **ne pas modifier** (réutilisée en lecture via `meteo_cache`)
- [ ] Aucune variable `NEXT_PUBLIC_ANTHROPIC_*` présente (la clé doit rester server-only)

---

### A2 — Crontab supercronic — AUCUNE MODIFICATION Sprint 8

**Le crontab `artifacts/08-infra/crontab` n'est PAS modifié pour Sprint 8.**

Justification (D-8-08 BINDING / D-07) :
- Le pipeline bot est déclenché par chaque `POST /api/.../chat/messages` (fire-and-forget dans
  le process Node) — pas un cron périodique.
- La purge messages (90j) et accueil (30j) est SQL-pur via `pg_cron` (migration 021) — pas supercronic.
- L'accueil Claw est déclenché par `GET /api/auth/qr/[token]` (greffe sur le flux QR existant) — pas un cron.

Vérification : confirmer que le crontab est identique au Sprint 7.

```bash
# Depuis la racine du projet
# Le fichier ne doit avoir aucune ligne nouvelle Sprint 8
cat artifacts/08-infra/crontab
```

Lignes attendues (identiques Sprint 7) :
```
0 18 * * *   /api/cron/cr          -- CRs journaliers
0  * * * *   /api/cron/jalons      -- Jalons toutes les heures
30 6 * * 1   /api/cron/briefing    -- Briefing lundi 06h30 UTC
0  7 * * *   /api/cron/derives     -- Dérives 07h00 UTC
15 7 * * 1   /api/cron/rapports-hebdo -- Hebdo lundi 07h15 UTC
```

- [ ] Crontab inchangé — aucune ligne Sprint 8 ajoutée
- [ ] L'image `clawbtp-cron` sera rebuild par CI/CD (même Dockerfile.cron, même crontab) — pas d'impact

---

### A3 — Migrations Supabase (BLOQUANT — appliquer AVANT merge/deploy)

**L'ordre est IMPÉRATIF. Chaque migration dépend de la précédente.**

#### Ordre global complet (depuis prod 001-013 actuel)

```
014 → 015 → 016 → 017 → 018 → 019 → 020 → 021
```

Si Sprint 6 (014+015) et Sprint 7 (016+017) sont déjà appliqués → commencer à 018.

```sql
-- Vérifier l'état actuel avant de commencer
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'derives_detectees','seuils_derives',       -- Sprint 6 (014,015)
    'briefings','meteo_cache',                  -- Sprint 7 (016,017)
    'chats','messages','action_proposals','claw_accueil_log'  -- Sprint 8 (018,019,020)
  )
ORDER BY table_name;
```

#### Application migrations Sprint 8

Procédure complète dans `artifacts/08-infra/MIGRATION_018_021_APPLY.md`.

- [ ] Étape 0 : audit pré-migration effectué (018-021 absentes, 014-017 présentes)
- [ ] **Migration 018** appliquée — tables `chats` + `messages` + enum `message_type`
  - [ ] `chats.chantier_id` UNIQUE présent
  - [ ] RLS activé, `authenticated` SELECT only
  - [ ] Index `idx_messages_chat_created` et `idx_messages_pending_bot` présents
- [ ] **Migration 019** appliquée — table `action_proposals` + enums + extension `notification_type`
  - [ ] Enum `action_type` = `{creer_tache,ajouter_cr,replanifier,alerte}`
  - [ ] Enum `action_proposal_statut` = `{pending,valide,rejete,execute}`
  - [ ] `notification_type` contient `action_proposal` ET `alerte_chat` (D-8-20 — ADD VALUE isolés)
  - [ ] `notification_type` contient toujours `derive_proactive` + `briefing_lundi` (rétro)
  - [ ] `messages.action_proposal_id` FK nullable ajoutée
- [ ] **Migration 020** appliquée — table `claw_accueil_log`
  - [ ] Index UNIQUE `uq_claw_accueil_user_date` présent
  - [ ] `authenticated` : 0 GRANT (table technique — D-8-04)
  - [ ] RLS FOR ALL USING(false) — service_role only
- [ ] **Migration 021** appliquée — pg_cron purges
  - [ ] Résultat : no-op silencieux si pg_cron absent, ou 2 jobs créés si pg_cron présent
  - [ ] Jobs `purge-chat-messages` et `purge-claw-accueil` vérifiés (si pg_cron présent)
  - [ ] Crontab supercronic NON modifié (confirmer)

---

### A4 — Gates qualité locaux

- [ ] `npm run lint` passe (0 erreur)
- [ ] `npx tsc --noEmit` passe (0 erreur TypeScript)
- [ ] `npm test` passe (Vitest — 0 failed, inclut tests chat Sprint 8)
- [ ] `npm run build` passe (next build — 0 erreur)

Points de contrôle spécifiques Sprint 8 :
- [ ] `grep -r "executerAction" artifacts/07-code/lib/chat/pipeline-bot.ts` → 0 résultat (S-8-09 CRITICAL)
- [ ] `grep -r "note_privee" artifacts/07-code/lib/chat/` → 0 résultat (D-051 BINDING)
- [ ] `grep -r "dangerouslySetInnerHTML" artifacts/07-code/components/chat/` → 0 résultat (EXI-8-06)
- [ ] `grep -r "select('\*')" artifacts/07-code/lib/chat/` → 0 résultat (EXI-8-02)

---

## Phase B — Deploy

### B1 — Merge et push

- [ ] Migrations 018, 019, 020, 021 appliquées et vérifiées (A3 complet)
- [ ] Variables d'env confirmées inchangées (A1)
- [ ] Crontab inchangé (A2)
- [ ] Tests locaux OK (A4)
- [ ] PR Sprint 8 mergée sur `main`
- [ ] `git push origin main` exécuté
- [ ] Commit hash noté : ____________________

### B2 — CI/CD GitHub Actions

- [ ] Job `quality` passe (lint + typecheck + tests Sprint 8 inclus)
- [ ] Job `build` passe : deux images buildées et poussées sur GHCR
  - `ghcr.io/[org]/clawbtp:[sha]` — image app (code Sprint 8 + runtime nodejs handlers chat)
  - `ghcr.io/[org]/clawbtp-cron:[sha]` — image cron (crontab INCHANGÉ — rebuild informatif)
- [ ] Job `deploy` passe : `docker stack deploy` sur le VPS OVH

### B3 — Healthcheck post-deploy

```bash
curl -s https://saas-gestion-chantier.tanren-studio.com/api/health
# ATTENDU : {"data":{"status":"ok",...}}  HTTP 200
```

- [ ] `GET /api/health` retourne HTTP 200
- [ ] Replicas app running dans Dokploy (2/2 selon config existante)
- [ ] Replica cron running (1/1 — crontab inchangé)

---

## Phase C — Vérifications post-deploy

### C1 — Chat auto à la création chantier (D-8-01 / PO-8-04=A)

Vérifier que le handler `POST /api/chantiers` crée un chat automatiquement.

```bash
# Récupérer un token admin valide (copier depuis le navigateur : F12 > Network > Bearer)
# Créer un chantier de test
curl -s -w "\nHTTP: %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer [TOKEN_ADMIN]" \
  -H "Content-Type: application/json" \
  -d '{"nom":"Chantier Test Chat Sprint 8","statut":"actif"}' \
  https://saas-gestion-chantier.tanren-studio.com/api/chantiers
# ATTENDU : HTTP 201 — le chantier est créé
```

Puis vérifier en base :

```sql
-- Vérifier que le chat a été créé pour le chantier (best-effort — peut ne pas exister si INSERT chat KO)
SELECT c.id, c.chantier_id, c.messages_count, c.created_at
FROM chats c
JOIN chantiers ch ON ch.id = c.chantier_id
WHERE ch.nom = 'Chantier Test Chat Sprint 8';
-- ATTENDU : 1 ligne (chat créé automatiquement)

-- Vérifier l'unicité : tenter de créer un 2e chat sur le même chantier → doit violer UNIQUE
-- INSERT INTO chats (chantier_id, organisation_id) VALUES ([id_chantier], [id_org]);
-- ATTENDU : erreur contrainte UNIQUE (si exécuté en dehors du handler)
```

- [ ] Chantier créé → chat auto inséré (vérif SQL ou GET `/api/chantiers/[id]/chat`)
- [ ] Un seul chat par chantier (UNIQUE enforced)

---

### C2 — POST message et pipeline bot (D-8-11 / ADR-8-001)

Le test de smoke fondamental : un message posté doit retourner 201 immédiatement, et la proposition
bot doit apparaître au polling suivant (≤30s).

```bash
# Récupérer le chat_id du chantier de test (C1)
# puis :
curl -s -w "\nHTTP: %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer [TOKEN_ADMIN]" \
  -H "Content-Type: application/json" \
  -d '{"contenu":"@claw crée une tâche pour vérifier la dalle demain matin"}' \
  https://saas-gestion-chantier.tanren-studio.com/api/chantiers/[CHANTIER_ID]/chat/messages
# ATTENDU : HTTP 201 rapide (< 500ms) — pas d'attente du pipeline
```

Attendre 5-30 secondes (pipeline asynchrone), puis :

```sql
-- Vérifier l'action_proposals créée
SELECT ap.type, ap.statut, ap.payload, ap.created_at
FROM action_proposals ap
JOIN chantiers ch ON ch.id = ap.chantier_id
WHERE ch.nom = 'Chantier Test Chat Sprint 8'
ORDER BY ap.created_at DESC LIMIT 3;
-- ATTENDU : 1 ligne statut=pending (si l'intention a été détectée "action_a_proposer" ou "claw_inline")

-- Vérifier le message bot inséré
SELECT type, contenu, created_at FROM messages
WHERE chat_id = (SELECT id FROM chats WHERE chantier_id = [CHANTIER_ID])
ORDER BY created_at DESC LIMIT 5;
-- ATTENDU : le message user posté + éventuellement un message bot (type=bot)
```

- [ ] POST message → 201 immédiat (pipeline non-bloquant — D-8-11 confirmé)
- [ ] Message bot / proposition apparaît au polling suivant (≤30s)
- [ ] Si intention neutre : aucune proposition (normal — 85% des messages)
- [ ] Logs app ne contiennent pas d'erreur critique pipeline :
  ```bash
  ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
    "sudo docker service logs clawbtp_app --since 5m 2>&1 | grep -i 'pipeline\|bot\|chat'"
  ```

---

### C3 — Accueil Claw au scan QR (D-8-16 / RG-ACCUEIL-001)

Vérifier que le scan QR d'un ouvrier déclenche la génération de l'accueil Claw (best-effort).

```sql
-- Vérifier l'état actuel de claw_accueil_log (avant test)
SELECT COUNT(*) FROM claw_accueil_log WHERE date_accueil = CURRENT_DATE;
-- ATTENDU : N lignes (ouvrières ayant scanné aujourd'hui)

-- Après un scan ouvrier de test :
SELECT user_id, contenu, meteo_disponible, llm_utilise, created_at
FROM claw_accueil_log
WHERE date_accueil = CURRENT_DATE
ORDER BY created_at DESC LIMIT 3;
-- ATTENDU : 1 ligne par ouvrier+jour (idempotence garantie par UNIQUE INDEX)
-- contenu : message d'accueil Haiku (ou fallback déterministe si trial_expired)
-- llm_utilise : true si Haiku appelé, false si fallback
```

- [ ] Scan QR → session créée NORMALEMENT (le scan ne bloque pas si accueil KO — D-8-16)
- [ ] `claw_accueil_log` contient une entrée pour l'ouvrier du jour
- [ ] Re-scan le même jour → pas de doublon (UNIQUE `uq_claw_accueil_user_date`)
- [ ] Logs ne contiennent pas d'erreur bloquante dans le chemin QR :
  ```bash
  ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
    "sudo docker service logs clawbtp_app --since 5m 2>&1 | grep -i 'accueil\|qr\|claw'"
  ```

---

### C4 — Sécurité RLS : écriture directe bloquée (D-8-04)

```sql
-- Depuis SQL Editor Supabase (client non-service_role) :
-- Ces INSERT doivent échouer avec une violation RLS

-- Test 1 : INSERT messages via client authenticated → DOIT ÉCHOUER
-- (À tester depuis une session authenticated, pas depuis le Dashboard service_role)

-- Test 2 : INSERT action_proposals via client authenticated → DOIT ÉCHOUER

-- Vérification des politiques RLS
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('chats','messages','action_proposals','claw_accueil_log')
ORDER BY tablename, policyname;
-- ATTENDU :
-- chats : INSERT WITH CHECK(false), UPDATE WITH CHECK(false), DELETE USING(false), SELECT USING(org)
-- messages : idem
-- action_proposals : idem
-- claw_accueil_log : FOR ALL USING(false) WITH CHECK(false)
```

- [ ] Politiques RLS vérifiées pour les 4 tables Sprint 8
- [ ] `claw_accueil_log` : FOR ALL bloqué pour authenticated

---

### C5 — Vérification pg_cron purge (si disponible)

```sql
-- Vérifier que les jobs purge sont actifs
SELECT jobname, schedule, command, active
FROM cron.job
WHERE jobname IN ('purge-chat-messages','purge-claw-accueil');
-- Si pg_cron présent — ATTENDU : 2 lignes, active=true
-- Si pg_cron absent — 0 lignes (normal — purge à gérer manuellement si besoin)

-- Test manuel de la purge (en ajoutant une ligne avec created_at > 90j) :
-- NE PAS exécuter en prod sans données de test
```

- [ ] pg_cron présent → 2 jobs actifs (`purge-chat-messages` + `purge-claw-accueil`)
- [ ] pg_cron absent → documenter ici : purge manuelle à prévoir si messages > 90j s'accumulent

---

### C6 — Vérification endpoints sans auth (protection 401/403)

```bash
# Chat sans auth → 401 (pas de token)
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/chantiers/00000000-0000-0000-0000-000000000001/chat
# ATTENDU : 401

# Propositions sans auth → 401
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/chantiers/00000000-0000-0000-0000-000000000001/action-proposals
# ATTENDU : 401

# Accueil-claw sans cookie → 401
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/ouvrier/accueil-claw
# ATTENDU : 401

# POST message sans auth → 401
curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d '{"contenu":"test"}' \
  https://saas-gestion-chantier.tanren-studio.com/api/chantiers/00000000-0000-0000-0000-000000000001/chat/messages
# ATTENDU : 401

# DELETE message (conducteur → 403)
# (nécessite un token conducteur valide et un message existant)
```

- [ ] GET chat sans auth → 401
- [ ] GET action-proposals sans auth → 401
- [ ] GET accueil-claw sans cookie → 401
- [ ] POST message sans auth → 401

---

## Phase D — Smoke UI Sprint 8 (manuel — REQUIS pour validation sprint)

Executer avec un compte admin sur `https://saas-gestion-chantier.tanren-studio.com`.

### D1 — Onglet Chat admin (US-066, US-067, US-068)

- [ ] Naviguer vers un chantier actif → onglet "Chat" visible (`data-testid="tab-chat-chantier"`)
- [ ] Le fil de messages s'affiche (`data-testid="fil-messages-chat"`)
- [ ] Zone de saisie disponible (`data-testid="input-message-chat"`)
- [ ] Bouton "Envoyer" disponible (`data-testid="btn-envoyer-message"`)
- [ ] Envoyer un message → 201 rapide, message apparaît dans le fil
- [ ] Compteur caractères visible (`data-testid="char-count-message"`)
- [ ] Bouton supprimer visible pour l'admin sur ses messages (`data-testid="btn-supprimer-message-{id}"`)

### D2 — Pipeline bot et propositions (US-070, US-071, US-072)

- [ ] Envoyer un message avec intention claire (ex: "Je vais terminer la dalle demain, quelqu'un peut créer une tâche de vérification ?")
- [ ] Attendre ≤30s (polling) → un message bot et/ou une proposition apparaît
- [ ] Naviguer vers `/admin/chantiers/[id]/propositions` → page de validation visible (`data-testid="file-propositions-action"`)
- [ ] Badge propositions pending visible si ≥1 proposition (`data-testid="badge-propositions-pending"`)
- [ ] Proposition affiche le type (creer_tache / ajouter_cr / replanifier / alerte) et le payload

### D3 — Valider / Rejeter une proposition (US-073, US-077)

- [ ] Cliquer "Valider" sur une proposition pending → proposition passe à `execute` (ou `valide` si erreur_execution)
- [ ] Si `creer_tache` : vérifier qu'une tâche a bien été créée dans le chantier
- [ ] Cliquer "Rejeter" sur une autre proposition → proposition passe à `rejete`
- [ ] Tenter de re-valider une proposition rejetée → 409 (ou message d'erreur UI)

### D4 — Notifications proposition (US-080)

- [ ] Conducteur rattaché au chantier reçoit une notification de type `action_proposal` (icône Bot indigo `#6366F1`)
- [ ] La notification redirige vers `/conducteur/chantiers/[id]/propositions`

### D5 — Chat conducteur (US-067, US-068, US-072)

- [ ] Se connecter en conducteur rattaché → onglet "Chat" visible
- [ ] Envoyer un message → 201 (dual-path JWT conducteur)
- [ ] Section "Propositions à valider" visible avec badge count

### D6 — Accueil Claw ouvrier (US-084, US-085)

- [ ] Simuler un scan QR ouvrier (ou utiliser le scan réel mobile)
- [ ] Page tâches ouvrier (`/mobile/taches`) → bannière accueil visible (`data-testid="banniere-accueil-claw"`)
- [ ] Contenu lisible (tâches du jour + météo si cache disponible + message motivant)
- [ ] Bouton fermer présent (`data-testid="btn-fermer-accueil-claw"`)
- [ ] Re-scan → même accueil (pas de doublon en base)

### D7 — Chat ouvrier PWA (US-069, F001 Itachi)

- [ ] Ouvrier accède au chat via `/mobile/chantiers/[id]/chat`
- [ ] Zone de saisie disponible (sans bouton "supprimer")
- [ ] Envoyer un message → 201 (dual-path cookie ouvrier)

### D8 — Archivage chantier (US-081, D-8-07)

- [ ] Archiver un chantier avec des propositions pending
- [ ] POST message dans le chat archivé → 403 "Ce chat est fermé"
- [ ] Les propositions pending sont passées à `rejete` automatiquement
- [ ] Message system visible dans le fil : "Chantier archivé. N propositions rejetées."

### D9 — Modération (US-082, PO-8-06=A)

- [ ] Admin : cliquer "Supprimer" sur un message → soft-delete, contenu masqué en "[Message supprimé]"
- [ ] Re-supprimer le même message → 404 (ou message UI approprié)
- [ ] Conducteur : bouton supprimer absent (admin only)

### D10 — RGPD (point de validation humaine requis avant prod réelle)

- [ ] Confirmer que le DPA Anthropic couvre le traitement de données personnelles potentielles (contenu chat)
- [ ] Mentionner dans les CGU/politique de confidentialité que le contenu du chat est traité par Anthropic (US)
- [ ] `note_privee_conducteur` : confirmer qu'aucune note privée n'apparaît dans les propositions ou réponses bot

---

## Risques de déploiement Sprint 8

| Risque | Mitigation | Criticité |
|--------|-----------|-----------|
| **Ordre migrations** : 018 avant 019 (FK `messages.action_proposal_id` dépend de `action_proposals`) | Application séquentielle stricte selon MIGRATION_018_021_APPLY.md. Audit Étape 0. | BLOQUANT |
| **Enums ADD VALUE même transaction** : `action_proposal`/`alerte_chat` insérés dans 019 avant leur usage (D-8-20) | ADD VALUE isolés en fin de 019 dans deux DO $$ séparés. Si erreur : appliquer les deux parties séparément. | BLOQUANT |
| **Pipeline fire-and-forget avec replicas: 2** (ADR-8-001) | Sémantique at-most-once documentée et acceptée. Aucune modification de replicas requise. | Non-bloquant (at-most-once accepté) |
| **ANTHROPIC_API_KEY invalide ou quota** | Best-effort : pipeline skip + log pino. Message humain 201 toujours retourné. | Dégradé (feature bot KO, chat OK) |
| **import side-effect register.ts** (D-8-19) | Co-localisé EN PREMIER dans `pipeline-bot.ts` + `genererAccueilClaw.ts`. Test obligatoire par Amelia. | BLOQUANT (LLM client not registered) |
| **Migration 021 : pg_cron absent** | Conditionnel IF EXISTS — no-op silencieux. Purge manuelle à planifier si besoin. | Non-bloquant (purge absente ≠ data loss immédiat) |
| **RLS WITH CHECK(false)** non appliqué (migration 018/019 échoue) | Vérifications post-migration obligatoires (Étapes 1+2 MIGRATION_018_021_APPLY.md). | BLOQUANT (écriture PostgREST directe possible) |
| **`note_privee_conducteur` dans les prompts** (D-051) | `construireContexteBot` + `genererAccueilClaw` : SELECT champ par champ, grep = 0. Tests Amelia validés avant merge. | BLOQUANT (sécurité) |
| **Accueil Claw bloque le scan** (D-8-16) | Best-effort total : try/catch englobe toute la logique accueil. Test Amelia : Haiku KO → scan réussit. | Critique si best-effort mal implémenté |
| **Double validation proposition** (D-8-19) | `statut != 'pending'` → 409. Idempotence DB. Test Amelia explicit. | Non-bloquant (409 propre) |
| **Coût LLM non anticipé** | ~$3.33/mois 5 chantiers (specs §7.2). Rate-limit 10 Sonnet/h/chantier (D-8-17). Trial-gate → 0 LLM (D-8-18). | Monitoring recommandé (logs pino tokens) |

---

## Rollback global Sprint 8

### Option 1 — Rollback code (Dokploy)

```
Dokploy > service clawbtp-app > Deployments > dernier deploy Sprint 7 stable > Redeploy
```

Le code Sprint 7 ignore les tables `chats`, `messages`, `action_proposals`, `claw_accueil_log`
(inconnues de lui). Les migrations Sprint 8 restent en base (inoffensives pour le code Sprint 7).

Le handler QR (`/api/auth/qr/[token]`) revert à sa version Sprint 7 → plus d'accueil Claw.
Le handler `POST /api/chantiers` revert → plus de création chat auto.

### Option 2 — Rollback migrations (si nécessaire)

Voir section "Rollback migrations Sprint 8" dans `MIGRATION_018_021_APPLY.md`.
Ne rollback que si le code Sprint 7 est déjà revert (Dokploy).

Ordre de rollback : 021 → 020 → 019 → 018.

Note : les valeurs d'enum `action_proposal` et `alerte_chat` ajoutées à `notification_type`
ne peuvent pas être retirées par DROP. Ce n'est pas bloquant — le code Sprint 7 ne les utilise pas.

---

## Récapitulatif des actions

| Action | Responsable | Bloquant ? | Réf |
|--------|-------------|-----------|-----|
| Confirmer `ANTHROPIC_API_KEY` dans Dokploy | Dev/PO | OUI (LLM KO sinon, best-effort mais dégradé total) | D-7-04 / D-8-12 |
| Confirmer `CRON_SECRET` dans Dokploy | Dev/PO | OUI (crons existants) | D-6-02 |
| Confirmer crontab INCHANGÉ | Dev | OUI (aucune ligne à ajouter) | D-8-08 / D-07 |
| Migration 018 SQL Editor Supabase | Dev/PO | OUI — table absente = 500 sur tout endpoint chat | D-8-01 |
| Migration 019 SQL Editor Supabase | Dev/PO | OUI — enums absents = INSERT KO | D-8-20 |
| Migration 020 SQL Editor Supabase | Dev/PO | OUI — table absente = accueil KO (best-effort scan OK quand même) | D-8-16 |
| Migration 021 SQL Editor Supabase | Dev/PO | NON bloquant (purge absente = accumulation lente) | D-8-08 |
| Vérifier ADD VALUE isolés fin 019 | Dev | OUI — migration 019 échoue sinon | D-8-20 |
| Merge + push + CI/CD Dokploy | Dev | OUI | — |
| Test C2 (POST message → 201 rapide) | Dev/PO | OUI — smoke pipeline non-bloquant | ADR-8-001 |
| Test C3 (scan QR → accueil Claw) | Dev/PO | OUI — smoke feature #9 | D-8-16 |
| Smoke UI D1-D10 (chat, propositions, accueil, archivage) | Dev/PO | OUI (règle validation sprint CLAUDE.md §8) | V-8-17 |
| Validation RGPD (D10) | PO | OUI avant prod réelle (commercialisation) | Impl. Plan §RGPD |
