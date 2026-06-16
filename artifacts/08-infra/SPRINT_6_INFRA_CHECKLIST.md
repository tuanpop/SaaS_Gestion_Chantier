# Checklist infra Sprint 6 — ClawBTP IA Détection Proactive des Dérives
*Produit : 2026-06-16 | Tanjiro | Sprint 6*
*Références binding : D-6-02, D-6-06, D-6-09, D-6-12, D-6-13, ADR-6-005, V-01, V-14*
*Procédure migrations détaillée : `artifacts/08-infra/MIGRATION_014_015_APPLY.md`*

---

## Résumé Sprint 6 côté infra

| Changement | Nature | Impact |
|------------|--------|--------|
| Correction crontab `derive` → `derives` (pluriel) | 1 ligne modifiée dans `artifacts/08-infra/crontab` | Rebuild image `clawbtp-cron` requis |
| Migration 014 `derives_detectees` | SQL manuel Supabase Dashboard | AVANT migration 015 |
| Migration 015 `seuils_derives` | SQL manuel Supabase Dashboard | APRÈS migration 014 |
| `ANTHROPIC_API_KEY` | Déjà présente (Sprint 5) | Confirmer seulement |
| `CRON_SECRET` | Déjà présent (Sprint 4) | Confirmer seulement |
| Aucune nouvelle variable d'environnement | — | Sprint 6 réutilise tout |

---

## Phase A — Pré-deploy (AVANT le merge)

### A1 — Confirmation variables d'environnement Dokploy (pas de nouveau secret Sprint 6)

Sprint 6 ne requiert **aucune nouvelle variable d'environnement**. Les secrets existants couvrent
tout le besoin :

| Variable | Usage Sprint 6 | Où confirmer | Attendu |
|----------|---------------|--------------|---------|
| `ANTHROPIC_API_KEY` | Appels Haiku `genererMessageDerive` via `ILLMClient` | Dokploy > service `saas-gestion-chantier-app` > Environment | Présente (ajoutée Sprint 5) |
| `CRON_SECRET` | Header `x-cron-secret` sur `POST /api/cron/derives` | Dokploy > service > Environment (ou Docker secret `cron_secret`) | Présent (ajouté Sprint 4) |
| `SUPABASE_SERVICE_ROLE_KEY` | `adminClient` — toutes les écritures dérives/seuils (D-6-09) | Dokploy > service > Environment | Présente |
| `NEXT_PUBLIC_SUPABASE_URL` | Client Supabase côté client | Environment + Build-time Arguments | Présente |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client Supabase côté client | Environment + Build-time Arguments | Présente |

Checklist de vérification :
- [ ] `ANTHROPIC_API_KEY` présente et non vide dans Dokploy — **ne pas modifier** (même clé Haiku qu'en Sprint 5, modèle `claude-haiku-4-5` hardcodé dans `AnthropicClient`)
- [ ] `CRON_SECRET` présent dans Dokploy — **ne pas modifier** (même secret que les autres crons)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` présente — **ne pas modifier**
- [ ] **Aucune autre variable à ajouter**

> Note TST-K6-32 (Kakashi) : `ANTHROPIC_API_KEY` et `CRON_SECRET` sont serveur uniquement,
> jamais `NEXT_PUBLIC_`, jamais loggués (pino `redact` en place). Ne pas les exposer dans
> les Build-time Arguments.

---

### A2 — Correction crontab (D-6-13 / ADR-6-005 / V-01)

**La correction est déjà appliquée** dans `artifacts/08-infra/crontab` (ce repository).

Vérification avant/après :

**AVANT (ligne héritée Sprint 4 — endpoint mort, singulier) :**
```
0 7 * * * curl -sf -X POST -H "x-cron-secret: ${CRON_SECRET}" "${APP_INTERNAL_URL}/api/cron/derive"
```

**APRÈS (ligne Sprint 6 — endpoint implémenté, pluriel) :**
```
0 7 * * * curl -sf -X POST -H "x-cron-secret: ${CRON_SECRET}" "${APP_INTERNAL_URL}/api/cron/derives"
```

- [ ] Vérifier dans `artifacts/08-infra/crontab` ligne 3 : contient bien `/api/cron/derives` (pluriel, pas de `derive` singulier)
- [ ] Confirmer que la ligne `derive` singulière est ABSENTE du crontab (pas de doublon)
- [ ] Horaire confirmé : `0 7 * * *` = 07h00 UTC quotidien (D-6-02 / RYO-6-02)

L'image `clawbtp-cron` sera rebuild automatiquement au CI/CD (le `crontab` est copié dans l'image
via `COPY --chown=cron:cron crontab /etc/crontab` dans `Dockerfile.cron`).

---

### A3 — Migration 014 Supabase Dashboard (BLOQUANT — avant migration 015)

**BLOQUANT** : sans cette migration, `POST /api/cron/derives` échoue sur INSERT (table absente),
les GET dérives retournent 42P01.

- [ ] Exécuter les requêtes d'audit initial (Étape 1 de `MIGRATION_014_015_APPLY.md`)
- [ ] Appliquer le SQL de migration 014 (`artifacts/07-code/supabase/migrations/014_derives_detectees.sql`)
- [ ] Résultat : `Success. No rows returned.`
- [ ] Exécuter toutes les vérifications post-migration 014 (Étape 2 de `MIGRATION_014_015_APPLY.md`)
- [ ] Confirmer en particulier :
  - [ ] Index unique partiel `uq_derive_active_chantier_type_tache` présent avec `WHERE resolved_at IS NULL`
  - [ ] Enum `derive_type` créé (4 valeurs)
  - [ ] Enum `notification_type` contient désormais `derive_proactive`
  - [ ] RLS activé sur `derives_detectees`
  - [ ] `authenticated` : SELECT uniquement (pas INSERT/UPDATE/DELETE)
- [ ] Date d'application notée : ____________________

---

### A4 — Migration 015 Supabase Dashboard (BLOQUANT — après 014)

**BLOQUANT** : sans cette migration, `chargerSeuils` ne trouve pas la table et tombe en fallback
`SEUILS_DEFAUT` permanemment (fonctionnel mais pas testable). Les endpoints CRUD seuils échouent.

- [ ] Confirmer que la migration 014 est validée (A3 complet)
- [ ] Appliquer le SQL de migration 015 (`artifacts/07-code/supabase/migrations/015_seuils_derives.sql`)
- [ ] Résultat : `Success. No rows returned.`
- [ ] Exécuter toutes les vérifications post-migration 015 (Étape 3 de `MIGRATION_014_015_APPLY.md`)
- [ ] Confirmer en particulier :
  - [ ] CHECK SQL `ratio_budget >= 0.50 AND ratio_budget < 1` présent (EXI-Y-K6-07 BINDING)
  - [ ] Test CHECK : INSERT avec `ratio_budget = 0.40` → ERROR (si succès = BLOCKER)
  - [ ] Contrainte UNIQUE `organisation_id` présente
  - [ ] RLS activé, SELECT filtrée `role='admin'`
- [ ] Date d'application notée : ____________________

---

### A5 — Gates qualité locaux sur la branche Sprint 6

- [ ] `npm run lint` passe (0 erreur)
- [ ] `npx tsc --noEmit` passe (0 erreur TypeScript)
- [ ] `npm test` passe (Vitest — 0 failed)
- [ ] `npm run build` passe (next build — 0 erreur)

---

## Phase B — Deploy

### B1 — Merge et push

- [ ] PR Sprint 6 mergée sur `main` (squash merge recommandé)
- [ ] `git push origin main` exécuté
- [ ] Commit hash sur main noté : ____________________

### B2 — CI/CD GitHub Actions

- [ ] Job `quality` passe (lint + typecheck + tests)
- [ ] Job `build` passe : deux images buildées et poussées sur GHCR
  - `ghcr.io/[org]/clawbtp:[sha]` — image app
  - `ghcr.io/[org]/clawbtp-cron:[sha]` — image cron (contient le crontab corrigé)
- [ ] Job `deploy` passe : `docker stack deploy` sur le VPS

### B3 — Healthcheck post-deploy

- [ ] `GET https://saas-gestion-chantier.tanren-studio.com/api/health` retourne HTTP 200 :
  ```
  curl -s https://saas-gestion-chantier.tanren-studio.com/api/health
  ```
  Réponse attendue : `{"data":{"status":"ok",...}}`
- [ ] 2/2 replicas app running dans Dokploy (ou Docker Swarm)
- [ ] 1/1 replica cron running dans Dokploy

---

## Phase C — Vérifications post-deploy

### C1 — Vérification endpoint cron (V-01 CRITIQUE)

**Vérifier que le cron appelle bien `/api/cron/derives` (pluriel) et non l'ancien endpoint mort.**

**C1a — Test manuel de l'endpoint cron (sans attendre 07h00 UTC)**

```bash
# Récupérer le CRON_SECRET depuis Dokploy / docker secret (valeur connue du PO)
# Remplacer [CRON_SECRET_VALUE] par la valeur réelle

curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "x-cron-secret: [CRON_SECRET_VALUE]" \
  https://saas-gestion-chantier.tanren-studio.com/api/cron/derives
```

Résultat attendu : `200` (cron s'exécute) ou `200` avec body JSON `{"ok": true, ...}`.
Résultat en cas de problème :
- `401` → le header `x-cron-secret` n'est pas passé ou la valeur est incorrecte
- `404` → l'endpoint n'existe pas (Amelia n'a pas créé `app/api/cron/derives/route.ts`, ou le deploy n'est pas encore actif)
- `500` → erreur interne (migrations absentes ?)

**C1b — Vérifier que l'ancien endpoint singulier est mort**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "x-cron-secret: [CRON_SECRET_VALUE]" \
  https://saas-gestion-chantier.tanren-studio.com/api/cron/derive
```

Résultat attendu : `404` (endpoint singulier jamais implémenté, confirme qu'il est mort).
Si `200` : un endpoint `/api/cron/derive` (singulier) a été créé par erreur — à retirer.

**C1c — Vérifier le cron container**

```bash
ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
  "sudo docker service logs clawbtp_cron --since 10m 2>&1 | head -50"
```

Chercher dans les logs :
- La ligne supercronic du crontab (doit mentionner `/api/cron/derives` avec le pluriel)
- Pas de ligne mentionnant `/api/cron/derive` (singulier)
- Pas d'erreur de démarrage

**C1d — Vérifier que derive_proactive est dans l'enum (post-migration 014)**

```sql
-- SQL Editor Supabase
SELECT unnest(enum_range(NULL::notification_type))::text AS valeur;
```

`derive_proactive` doit être présent. Si absent : migration 014 incomplète.

---

### C2 — Smoke API endpoints dérives

**C2a — GET /api/chantiers/[id]/derives (sans auth → 401)**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/chantiers/00000000-0000-0000-0000-000000000001/derives
```

Résultat attendu : `401` (pas d'auth → refus, pas de 500).

**C2b — GET /api/derives (sans auth → 401)**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/derives
```

Résultat attendu : `401`.

**C2c — GET /api/organisations/me/seuils-derives (sans auth → 401)**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/organisations/me/seuils-derives
```

Résultat attendu : `401`.

---

### C3 — Vérification logs après premier passage cron à 07h00 UTC

Le lendemain du déploiement, après 07h00 UTC, vérifier les logs du service cron :

```bash
ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
  "sudo docker service logs clawbtp_cron --since 24h 2>&1 | grep -i 'derives\|cron\|derive'"
```

Chercher :
- Une entrée de log supercronic à ~07h00 UTC mentionnant `POST /api/cron/derives`
- Réponse HTTP 200 (curl `-sf` sort en erreur non-zéro si != 2xx, ce qui n'est pas logué par supercronic)

Vérifier aussi les logs de l'app pour l'exécution du handler :

```bash
ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
  "sudo docker service logs clawbtp_app --since 24h 2>&1 | grep -i 'cron/derives\|detection\|derive'"
```

Chercher : logs pino du handler cron avec `chantiers_traites`, `derives_nouvelles`, `derives_resolues`, `llm_appels`.

---

### C4 — Vérification base de données post-premier cron

```sql
-- Vérifier que le cron a bien tourné (dérives ou table vide selon l'état réel des chantiers)
SELECT COUNT(*) AS total_derives, COUNT(*) FILTER (WHERE resolved_at IS NULL) AS actives
FROM derives_detectees;
-- Si aucun chantier ne dérive : 0 lignes (normal)
-- Si des chantiers dérivent : N lignes avec resolved_at IS NULL

-- Vérifier qu'il n'y a pas de doublon (idempotence D-6-06)
SELECT chantier_id, type, tache_id, COUNT(*) AS nb
FROM derives_detectees
WHERE resolved_at IS NULL
GROUP BY chantier_id, type, tache_id
HAVING COUNT(*) > 1;
-- Attendu : 0 lignes (pas de doublon actif)
```

---

## Phase D — Smoke UI Sprint 6 (manuel)

### D1 — Page Réglages dérives (admin)

- [ ] Se connecter en tant qu'admin sur `https://saas-gestion-chantier.tanren-studio.com`
- [ ] Accéder à la page Paramètres → Alertes (ou navigation équivalente selon Hana)
- [ ] Les valeurs par défaut s'affichent : `ratio_budget=85%`, `jours_blocage=3`, `jours_inactivite=7`
- [ ] Source : `defaut` (aucune ligne en base pour cette org au départ)
- [ ] Modifier `ratio_budget` à `90%` → PATCH réussi → source passe à `db`
- [ ] Tenter `ratio_budget=40%` → erreur 400 validation (EXI-Y-K6-07, borne 50%)
- [ ] DELETE seuils → retour aux défauts, source `defaut`

### D2 — Section Alertes chantier

- [ ] Accéder à un chantier actif
- [ ] Section "Alertes" visible sur la page (reachability UI V-13)
- [ ] Si aucune dérive active : message "Aucune dérive détectée" (ou équivalent Hana)
- [ ] Si une dérive a été détectée par le cron : carte alerte visible avec le type et le message

### D3 — Notification in-app derive_proactive

- [ ] Déclencher manuellement le cron (C1a) sur un chantier qui dérive
- [ ] La cloche admin affiche une notification de type `derive_proactive`
- [ ] L'icône est `AlertOctagon` (non `Bell`)
- [ ] Le message est lisible (LLM ou fallback déterministe)

---

## Risques de déploiement Sprint 6

| Risque | Mitigation | Criticité |
|--------|-----------|-----------|
| Crontab appelle encore `derive` singulier (V-01) | Correction appliquée dans ce repo, rebuild image cron requis | CRITIQUE — le cron ne se déclenche jamais sinon |
| Migration 014 échoue sur `ADD VALUE` + usage même transaction (V-14) | `ADD VALUE` isolé en bloc `DO $$ ... $$` en fin de 014 ; si erreur, appliquer les deux parties séparément | BLOQUANT |
| `ANTHROPIC_API_KEY` expirée/révoquée | Vérifier dans Dokploy ; le cron continue avec fallback déterministe si LLM KO (D-6-03 best-effort) | Dégradé (alertes sans message LLM) |
| `derive_proactive` absent de l'enum au moment du déploiement code | Appliquer migration 014 AVANT le déploiement code | BLOQUANT — `insertNotification` échoue |
| CHECK SQL 015 absent (ratio_budget sans borne inf) | Vérifier test C INSERT 0.40 → ERROR ; si succès = STOPPER le déploiement | BLOCKER sécurité (EXI-Y-K6-07) |
| replicas cron > 1 (double-exécution) | `replicas: 1` dans docker-compose.yml (inchangé) ; idempotence DB en défense profonde | Non-bloquant si idempotence OK, mais à ne pas toucher |
| Redis résiduel (cleanup D-054 repoussé) | Ne pas toucher, ne pas supprimer pendant ce déploiement | Non-bloquant pour Sprint 6 |

---

## Récapitulatif des actions par responsabilité

| Action | Responsable | Bloquant ? | Ref |
|--------|-------------|-----------|-----|
| Confirmer `ANTHROPIC_API_KEY` dans Dokploy | Dev/PO | NON (best-effort LLM) | D-6-03 |
| Confirmer `CRON_SECRET` dans Dokploy | Dev/PO | OUI — cron 401 sinon | D-6-02 |
| Migration 014 SQL Editor Supabase | Dev/PO | OUI — table absente sinon | D-6-09 |
| Migration 015 SQL Editor Supabase | Dev/PO | OUI — seuils inaccessibles | D-6-08 |
| Vérifier CHECK 015 (`ratio_budget >= 0.50`) | Dev/PO | OUI sécurité | EXI-Y-K6-07 |
| Merge + push + CI/CD Dokploy | Dev | OUI | — |
| Test C1a (cron `/api/cron/derives` → 200) | Dev/PO | OUI — vérif V-01 | ADR-6-005 |
| Test C1b (cron `/api/cron/derive` singulier → 404) | Dev/PO | OUI — confirme endpoint mort | ADR-6-005 |
| Smoke UI page Réglages dérives | Dev/PO | OUI (règle validation sprint) | V-13 |

---

## Rollback global Sprint 6

**Option 1 — Rollback code (Dokploy) :**
Dokploy > service > Deployments > sélectionner le dernier deploy Sprint 5 stable > Redeploy.
Le code Sprint 5 ignore les tables `derives_detectees` et `seuils_derives` (inconnues de lui).
Le crontab revert aussi (image cron Sprint 5 contient l'ancienne ligne `derive` singulière — qui
appelait un endpoint mort, donc comportement inchangé par rapport à Sprint 5).

**Option 2 — Rollback migrations (si nécessaire) :**
Voir section "Rollback" de `MIGRATION_014_015_APPLY.md`. Ne rollback que si le code est déjà revertdi.
