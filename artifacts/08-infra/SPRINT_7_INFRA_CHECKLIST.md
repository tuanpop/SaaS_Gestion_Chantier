# Checklist infra Sprint 7 — ClawBTP IA Briefing Automatique Lundi Matin
*Produit : 2026-06-16 | Tanjiro | Sprint 7*
*Références binding : D-7-01, D-7-03, D-7-04, D-7-06, D-7-07, D-7-08, D-7-10, D-7-12, D-7-14, D-7-15, V-7-06, V-7-07, V-7-09, V-7-12*
*Procédure migrations détaillée : `artifacts/08-infra/MIGRATION_016_017_APPLY.md`*

---

## Résumé Sprint 7 côté infra

| Changement | Nature | Impact |
|------------|--------|--------|
| Crontab : correction ligne briefing `30 7` → `30 6` (06h30 UTC, D-7-03) | 1 ligne corrigée dans `artifacts/08-infra/crontab` | Rebuild image `clawbtp-cron` requis |
| Migration 016 `briefings` | SQL manuel Supabase Dashboard | AVANT migration 017 |
| Migration 017 `meteo_cache` | SQL manuel Supabase Dashboard | APRÈS migration 016 |
| `OPENWEATHER_API_KEY` | **NOUVELLE variable** — à ajouter dans Dokploy Environment | Server-only, jamais NEXT_PUBLIC_, startup check throw si absente |
| `ANTHROPIC_API_KEY` | Déjà présente (Sprint 5) — couvre Sonnet 4-6 (modèle choisi côté code D-7-11) | Confirmer seulement |
| `CRON_SECRET` | Déjà présent (Sprint 4) | Confirmer seulement |

### Ordre obligatoire global : 014 → 015 → 016 → 017 → code Sprint 7

Si Sprint 6 pas encore déployé (prod = 001-013) : appliquer 014+015 d'abord.
Prod actuelle selon PROJECT_STATE.md : **001-013** (014+015 à appliquer Sprint 6).

**Ordre complet si Sprint 6 et Sprint 7 déployés simultanément** :
```
014 (derives_detectees) → 015 (seuils_derives) → 016 (briefings) → 017 (meteo_cache) → code
```

---

## Phase A — Pré-deploy (AVANT le merge)

### A1 — Variables d'environnement Dokploy

#### OPENWEATHER_API_KEY — NOUVELLE (D-7-12 BINDING)

Sprint 7 requiert **une nouvelle variable d'environnement** :

| Variable | Valeur | Onglet Dokploy | Criticité |
|----------|--------|----------------|-----------|
| `OPENWEATHER_API_KEY` | Clé API OpenWeather One Call 3.0 | **Environment** (runtime uniquement) | BLOQUANT au boot |

**Obtenir la clé OpenWeather :**
1. Se connecter sur https://home.openweathermap.org/api_keys
2. Créer ou récupérer la clé pour le plan "One Call API 3.0" (plan gratuit inclut 1000 calls/jour)
3. La clé est au format alphanumériques, 32 chars environ

**Ajouter dans Dokploy :**
```
Dokploy UI → service clawbtp-app → onglet "Environment" → ajouter :
  OPENWEATHER_API_KEY = <clé obtenue ci-dessus>
→ Save
(NE PAS cliquer Deploy avant d'avoir appliqué les migrations et vérifié le reste)
```

**Points critiques (D-7-12 BINDING) :**
- JAMAIS `NEXT_PUBLIC_OPENWEATHER_API_KEY` — la clé ne doit JAMAIS être dans le bundle client
- JAMAIS dans l'onglet "Build-time Arguments" — runtime uniquement
- JAMAIS commitée dans le code ou un fichier versionné
- Le startup check throw au boot si absente — le container redémarre jusqu'à ce qu'elle soit présente
- La clé n'est JAMAIS loggée (le code logge uniquement le code_postal + statut HTTP, jamais l'URL avec `appid=`)

**Comportement si absente :**
- L'app ne démarrera pas (startup check throw — pattern `QR_ENCRYPTION_KEY` / D-7-12)
- Fournir la clé dans Dokploy Environment avant de déployer le code Sprint 7

**Comportement si clé présente mais invalide (401 OpenWeather) :**
- `fetchMeteo` retourne `MeteoSemaine.source='indisponible'` (best-effort D-7-07)
- Le briefing est quand même généré et notifié (sans météo)
- `meteo_erreurs` comptabilisé dans le log pino

#### Variables existantes à confirmer

| Variable | Usage Sprint 7 | Où confirmer | Attendu |
|----------|---------------|--------------|---------|
| `ANTHROPIC_API_KEY` | Appels Sonnet 4-6 via `ILLMClient` (modèle sélectionné côté code via `model: 'claude-sonnet-4-6'` — D-7-11) | Dokploy > service > Environment | Présente (ajoutée Sprint 5) |
| `CRON_SECRET` | Header `x-cron-secret` sur `POST /api/cron/briefing` | Dokploy > service > Environment | Présent (ajouté Sprint 4) |
| `SUPABASE_SERVICE_ROLE_KEY` | `adminClient` — écriture briefings/meteo_cache (D-7-10) | Dokploy > service > Environment | Présente |

Checklist de vérification :
- [ ] `OPENWEATHER_API_KEY` ajoutée dans Dokploy Environment (NON Build-time Arguments) — valeur réelle, pas `placeholder`
- [ ] `ANTHROPIC_API_KEY` présente et non vide — **ne pas modifier** (même clé, modèle Sonnet choisi côté code)
- [ ] `CRON_SECRET` présent dans Dokploy — **ne pas modifier**
- [ ] `SUPABASE_SERVICE_ROLE_KEY` présente — **ne pas modifier**

> Note sécurité : `OPENWEATHER_API_KEY`, `ANTHROPIC_API_KEY` et `CRON_SECRET` sont server-only,
> jamais `NEXT_PUBLIC_`, jamais loggués (pino `redact` en place). Ne pas les exposer dans
> les Build-time Arguments.

---

### A2 — Crontab Sprint 7 (D-7-03 BINDING — correction horaire)

**La correction est déjà appliquée** dans `artifacts/08-infra/crontab`.

**PROBLÈME CORRIGÉ** : la ligne briefing héritée dans le crontab était `30 7 * * 1` (07h30 UTC).
L'architecture D-7-03 prescrit `30 6 * * 1` (06h30 UTC) pour respecter l'ordre lundi :
06h00 jalons → **06h30 briefing** → 07h00 dérives → 07h15 hebdo.

Vérification avant/après :

**AVANT (ligne erronée — 07h30, après dérives et hebdo) :**
```
30 7 * * 1 curl -sf -X POST -H "x-cron-secret: ${CRON_SECRET}" "${APP_INTERNAL_URL}/api/cron/briefing"
```

**APRÈS (ligne Sprint 7 corrigée — 06h30, avant dérives et hebdo) :**
```
30 6 * * 1 curl -sf -X POST -H "x-cron-secret: ${CRON_SECRET}" "${APP_INTERNAL_URL}/api/cron/briefing"
```

- [ ] Vérifier dans `artifacts/08-infra/crontab` : ligne briefing = `30 6 * * 1` (pas `30 7 * * 1`)
- [ ] Confirmer l'ordre dans le fichier : jalons (toutes heures) → briefing 06h30 → dérives 07h00 → hebdo 07h15
- [ ] Confirmer que l'horaire dérives est toujours `0 7 * * *` (07h00 — inchangé Sprint 6)
- [ ] Confirmer que l'horaire hebdo est toujours `15 7 * * 1` (07h15 — inchangé Sprint 5)

L'image `clawbtp-cron` sera rebuild automatiquement au CI/CD (le `crontab` est copié via
`COPY --chown=cron:cron crontab /etc/crontab` dans `Dockerfile.cron`).

---

### A3 — Migration 016 Supabase Dashboard : table `briefings` (BLOQUANT)

**BLOQUANT** : sans cette migration, `POST /api/cron/briefing` échoue sur INSERT (table absente),
les GET briefings retournent 42P01, et surtout : le code insérant `type: 'briefing_lundi'` échoue
si l'enum n'est pas étendu.

- [ ] Exécuter les requêtes d'audit initial (Étape 1 de `MIGRATION_016_017_APPLY.md`)
- [ ] Confirmer que 014+015 sont bien appliquées (derives_detectees + seuils_derives existent)
- [ ] Appliquer le SQL de migration 016 (`artifacts/07-code/supabase/migrations/016_briefings.sql`)
- [ ] Résultat : `Success. No rows returned.`
- [ ] Exécuter toutes les vérifications post-migration 016 (Étape 2 de `MIGRATION_016_017_APPLY.md`)
- [ ] Confirmer en particulier :
  - [ ] Index unique `uq_briefing_chantier_semaine (chantier_id, annee_iso, semaine_iso)` présent
  - [ ] Test idempotence ON CONFLICT DO NOTHING → 1 seule ligne (pas d'erreur, pas de doublon)
  - [ ] `notification_type` contient désormais `briefing_lundi`
  - [ ] RLS activé : SELECT filtrée org JWT, INSERT WITH CHECK(false), pas de DELETE policy
  - [ ] `authenticated` : SELECT uniquement (pas INSERT/UPDATE/DELETE)
  - [ ] CHECK `char_length(contenu_genere) <= 8000` présent
- [ ] Date d'application notée : ____________________

---

### A4 — Migration 017 Supabase Dashboard : table `meteo_cache` (BLOQUANT — après 016)

**BLOQUANT** : sans cette migration, `fetchMeteo` ne peut pas écrire le cache → chaque passage
cron refait les appels OpenWeather (contourne D-7-06 borné par code_postal).

- [ ] Confirmer que la migration 016 est validée (A3 complet)
- [ ] Appliquer le SQL de migration 017 (`artifacts/07-code/supabase/migrations/017_meteo_cache.sql`)
- [ ] Résultat : `Success. No rows returned.`
- [ ] Exécuter toutes les vérifications post-migration 017 (Étape 3 de `MIGRATION_016_017_APPLY.md`)
- [ ] Confirmer en particulier :
  - [ ] RLS `USING(false) / WITH CHECK(false)` — aucune lecture/écriture authenticated
  - [ ] `authenticated` : 0 GRANTs (table technique, service_role only — D-7-10)
  - [ ] Test UPSERT idempotent (INSERT ON CONFLICT DO UPDATE, pas d'erreur)
  - [ ] CHECK `code_postal ~ '^\d{5}$'` présent
- [ ] Date d'application notée : ____________________

---

### A5 — Gates qualité locaux sur la branche Sprint 7

- [ ] `npm run lint` passe (0 erreur)
- [ ] `npx tsc --noEmit` passe (0 erreur TypeScript)
- [ ] `npm test` passe (Vitest — 0 failed)
- [ ] `npm run build` passe (next build — 0 erreur)

---

## Phase B — Deploy

### B1 — Merge et push

- [ ] Migrations 016 ET 017 appliquées et vérifiées (A3 + A4)
- [ ] `OPENWEATHER_API_KEY` ajoutée dans Dokploy Environment (A1)
- [ ] PR Sprint 7 mergée sur `main` (squash merge recommandé)
- [ ] `git push origin main` exécuté
- [ ] Commit hash sur main noté : ____________________

### B2 — CI/CD GitHub Actions

- [ ] Job `quality` passe (lint + typecheck + tests)
- [ ] Job `build` passe : deux images buildées et poussées sur GHCR
  - `ghcr.io/[org]/clawbtp:[sha]` — image app (contient le code Sprint 7)
  - `ghcr.io/[org]/clawbtp-cron:[sha]` — image cron (contient le crontab corrigé 06h30)
- [ ] Job `deploy` passe : `docker stack deploy` sur le VPS

### B3 — Healthcheck post-deploy

- [ ] `GET https://saas-gestion-chantier.tanren-studio.com/api/health` retourne HTTP 200 :
  ```bash
  curl -s https://saas-gestion-chantier.tanren-studio.com/api/health
  ```
  Réponse attendue : `{"data":{"status":"ok",...}}`
- [ ] 2/2 replicas app running dans Dokploy
- [ ] 1/1 replica cron running dans Dokploy (crontab 06h30 actif)

---

## Phase C — Vérifications post-deploy

### C1 — Startup check `OPENWEATHER_API_KEY` (D-7-12 CRITIQUE)

Si l'app démarre et `/api/health` répond 200, la startup check a passé : `OPENWEATHER_API_KEY`
est présente et non vide dans le process env.

Si l'app boucle en redémarrage (Dokploy montre des restarts) : la variable est absente ou vide.
Ajouter via Dokploy Environment → Save → Deploy.

- [ ] `/api/health` retourne 200 (startup check implicite)
- [ ] Logs app ne contiennent pas d'erreur "OPENWEATHER_API_KEY is not set" :
  ```bash
  ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
    "sudo docker service logs clawbtp_app --since 5m 2>&1 | grep -i 'openweather\|startup\|boot'"
  ```

---

### C2 — Vérification endpoint cron briefing (D-7-03 CRITIQUE)

**Test manuel de `/api/cron/briefing` sans attendre lundi 06h30 UTC.**

```bash
# Récupérer le CRON_SECRET depuis Dokploy
# Remplacer [CRON_SECRET_VALUE] par la valeur réelle

curl -s -w "\nHTTP: %{http_code}\n" \
  -X POST \
  -H "x-cron-secret: [CRON_SECRET_VALUE]" \
  https://saas-gestion-chantier.tanren-studio.com/api/cron/briefing
```

Résultat attendu : `200` avec body JSON :
```json
{
  "ok": true,
  "chantiers_traites": <N>,
  "briefings_crees": <N>,
  "briefings_skipped_existants": 0,
  "llm_appels": <N ou 0 si trial_expired>,
  "meteo_appels": <N>,
  "erreurs": []
}
```

Résultats en cas de problème :
- `401` → `x-cron-secret` incorrect ou absent
- `404` → l'endpoint `app/api/cron/briefing/route.ts` n'existe pas (Amelia) ou deploy non actif
- `500` → erreur interne : vérifier logs app (migration 016 absente ? `briefing_lundi` enum manquant ?)

**Vérifier 401 sans secret (protection ok) :**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  https://saas-gestion-chantier.tanren-studio.com/api/cron/briefing
```
Attendu : `401`

---

### C3 — Vérification endpoints GET briefings (sans auth → 401)

```bash
# GET /api/briefings (sans auth)
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/briefings
# Attendu : 401

# GET /api/briefings/[id] (sans auth — ID fictif)
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/briefings/00000000-0000-0000-0000-000000000001
# Attendu : 401 ou 404 (pas 500)

# GET /api/chantiers/[id]/briefings (sans auth)
curl -s -o /dev/null -w "%{http_code}" \
  https://saas-gestion-chantier.tanren-studio.com/api/chantiers/00000000-0000-0000-0000-000000000001/briefings
# Attendu : 401
```

---

### C4 — Vérification cron container (ligne 06h30 active)

```bash
ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
  "sudo docker service logs clawbtp_cron --since 10m 2>&1 | head -50"
```

Chercher dans les logs :
- Supercronic a chargé le crontab (ligne mentionnant `/api/cron/briefing` à 06h30)
- `30 6 * * 1` visible (pas `30 7 * * 1`)
- Pas d'erreur de démarrage supercronic

---

### C5 — Vérification base de données post-cron briefing

Après le premier passage cron (lundi 06h30 UTC) ou après un test manuel (C2) :

```sql
-- Vérifier que le cron a bien créé des briefings
SELECT COUNT(*) AS total_briefings,
       COUNT(*) FILTER (WHERE llm_utilise = true) AS avec_llm,
       COUNT(*) FILTER (WHERE meteo_disponible = true) AS avec_meteo,
       COUNT(*) FILTER (WHERE contenu_genere IS NULL) AS fallback
FROM briefings;
-- Si chantiers actifs existent : N lignes (1 par chantier actif)
-- Si org trial_expired : llm_utilise = false (D-7-08)

-- Vérifier l'idempotence (pas de doublon par chantier+semaine)
SELECT chantier_id, annee_iso, semaine_iso, COUNT(*) AS nb
FROM briefings
GROUP BY chantier_id, annee_iso, semaine_iso
HAVING COUNT(*) > 1;
-- Attendu : 0 lignes (pas de doublon)

-- Vérifier que briefing_lundi est dans l'enum et utilisé
SELECT type, COUNT(*) FROM notifications
WHERE type = 'briefing_lundi'
GROUP BY type;
-- Attendu : N lignes (1 notif par destinataire par chantier briefé)

-- Vérifier le cache météo (si chantiers avec code_postal valide)
SELECT code_postal, fetched_at, (fetched_at > NOW() - INTERVAL '6 hours') AS cache_valide
FROM meteo_cache;
-- Attendu : 1 ligne par code_postal distinct (cache partagé, pas 1/chantier)
```

---

### C6 — Vérification comportement météo (best-effort)

**Test fallback météo (D-7-07)** : si `OPENWEATHER_API_KEY` est temporairement invalide ou si
le code postal d'un chantier ne correspond à aucun résultat géographique, vérifier que le
briefing est quand même créé avec `meteo_disponible = false`.

```sql
-- Après un passage cron avec météo KO (clé invalide ou CP non résolu)
SELECT chantier_id, meteo_disponible, contenu_genere IS NOT NULL AS a_llm
FROM briefings
ORDER BY created_at DESC LIMIT 5;
-- Si météo KO : meteo_disponible = false, mais contenu_genere non null (Sonnet quand même appelé)
-- ou message_fallback non null si Sonnet aussi KO
```

---

### C7 — Vérification logs après premier passage cron réel (lundi 06h30 UTC)

Le lundi suivant le déploiement, après 06h30 UTC :

```bash
# Logs du container cron (supercronic a lancé le job)
ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
  "sudo docker service logs clawbtp_cron --since 2h 2>&1 | grep -i 'briefing\|cron'"

# Logs de l'app (handler cron exécuté)
ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 \
  "sudo docker service logs clawbtp_app --since 2h 2>&1 | grep -i 'briefing\|cron'"
```

Chercher dans les logs app (pino JSON) :
- `msg: "cron briefing démarré"` ou similaire
- `chantiers_traites: N`
- `briefings_crees: N`
- `llm_appels: N`
- `meteo_appels: N` (≤ nombre de codes postaux distincts — D-7-06)
- Absence de `appid=` dans les logs (D-7-12 BINDING — clé jamais loggée)

---

## Phase D — Smoke UI Sprint 7 (manuel)

### D1 — Notification briefing_lundi

- [ ] Se connecter en tant qu'admin sur `https://saas-gestion-chantier.tanren-studio.com`
- [ ] Déclencher manuellement le cron (C2) si lundi pas encore passé
- [ ] La cloche admin affiche une notification de type `briefing_lundi`
- [ ] L'icône est Sun (bleue — Hana Sprint 7) et non AlertOctagon (derive_proactive)
- [ ] Le message est lisible (LLM Sonnet ou fallback déterministe selon trial)

### D2 — Page liste briefings admin (`/admin/briefings`)

- [ ] Naviguer vers `/admin/briefings` (data-testid=page-briefings-admin)
- [ ] La liste des briefings de l'org s'affiche
- [ ] Chaque ligne indique : chantier, semaine, `llm_utilise` (badge), `meteo_disponible` (badge)
- [ ] Un clic sur un briefing mène à la page détail

### D3 — Page détail briefing (`/admin/briefings/[id]`)

- [ ] Le contenu Sonnet (ou fallback) s'affiche en texte lisible
- [ ] Pas de HTML brut affiché (rendu JSX pur — D-7-17)
- [ ] Section météo indique "indisponible" si `meteo_disponible=false`
- [ ] Aucun champ `donnees_brutes` / `meteo_snapshot` / `notification_ids` visible (exclus côté client)

### D4 — Section briefing dans la page chantier

- [ ] Accéder à un chantier actif (admin ou conducteur rattaché)
- [ ] Section "Briefing de la semaine" visible (`section-briefing-chantier` — D-7-14 reachability)
- [ ] Le briefing le plus récent s'affiche ou "Aucun briefing cette semaine" si non généré

### D5 — Cross-org IDOR (si deux orgs de test disponibles)

- [ ] Tenter d'accéder au briefing d'une autre org via l'URL directe → 404 (pas 403)
- [ ] Conducteur accède à `/api/briefings` consolidé → 403 (élévation refusée)

---

## Risques de déploiement Sprint 7

| Risque | Mitigation | Criticité |
|--------|-----------|-----------|
| `OPENWEATHER_API_KEY` absente au boot (startup check throw) | Ajouter dans Dokploy Environment AVANT deploy code. App ne démarre pas sinon. | BLOQUANT |
| Enum `briefing_lundi` absent (migration 016 non appliquée) | Appliquer 016 AVANT le code. `insertNotification` échoue sinon (invalid enum value). | BLOQUANT |
| Migration 016 échoue sur `ADD VALUE` dans même transaction (V-7-12) | `ADD VALUE` isolé en bloc `DO $$ ... $$` fin de 016. Si erreur, appliquer les deux parties séparément. | BLOQUANT |
| Ordre migrations Sprint 6 non appliqué (014+015 absentes) | Vérifier audit initial (Étape 1 MIGRATION_016_017_APPLY.md). 016 peut dépendre de notification_type ayant derive_proactive. | BLOQUANT |
| Crontab ligne 06h30 pas prise en compte (ancienne image) | Rebuild image `clawbtp-cron` garanti par CI/CD (COPY crontab). Vérifier logs cron après deploy (C4). | CRITIQUE |
| `ANTHROPIC_API_KEY` valide pour Sonnet 4-6 | Même clé que Haiku (D-7-11 — modèle choisi côté code). Vérifier dans Dokploy. Si clé invalide : best-effort → briefing fallback. | Dégradé |
| OpenWeather clé invalide ou quota dépassé (429) | best-effort D-7-07 → `meteo_disponible=false`, briefing quand même créé. Vérifier C6. | Dégradé |
| Double run cron si replicas > 1 | `replicas: 1` dans docker-compose.yml — ne pas modifier. Idempotence DB (D-7-01) en défense profondeur. | Non-bloquant si idempotence OK |
| OPENWEATHER_API_KEY dans les logs (D-7-12) | Code logge uniquement code_postal + statut. Jamais l'URL avec `appid=`. Vérifier C7 (grep sur `appid`). | Sécurité (si leak) |
| `note_privee_conducteur` dans le prompt Sonnet (V-7-03) | Structurellement absent des types `JalonSemaine`/`SignauxBriefingChantier` (D-051). Vérifier tests Amelia. | Sécurité |

---

## Récapitulatif des actions par responsabilité

| Action | Responsable | Bloquant ? | Ref |
|--------|-------------|-----------|-----|
| Ajouter `OPENWEATHER_API_KEY` dans Dokploy Environment | Dev/PO | OUI — startup check throw | D-7-12 |
| Confirmer `ANTHROPIC_API_KEY` dans Dokploy | Dev/PO | NON (best-effort LLM) | D-7-04 |
| Confirmer `CRON_SECRET` dans Dokploy | Dev/PO | OUI — cron 401 sinon | D-7-03 |
| Migration 016 SQL Editor Supabase | Dev/PO | OUI — table + enum absents | D-7-01 |
| Migration 017 SQL Editor Supabase | Dev/PO | OUI — cache météo absent | D-7-06 |
| Vérifier idempotence ON CONFLICT 016 | Dev/PO | OUI — doublons briefings sinon | D-7-01 |
| Vérifier RLS meteo_cache sans GRANT authenticated | Dev/PO | OUI sécurité | D-7-10 |
| Merge + push + CI/CD Dokploy | Dev | OUI | — |
| Test C2 (cron `/api/cron/briefing` → 200) | Dev/PO | OUI — vérif endpoint actif | D-7-03 |
| Test C2 (cron sans secret → 401) | Dev/PO | OUI — vérif protection | D-7-03 |
| Smoke UI D1-D4 (briefings, notifs, pages) | Dev/PO | OUI (règle validation sprint) | V-7-14 |
| Vérification logs C7 (lundi prochain) | Dev/PO | OUI — confirme cron réel | D-7-03 |

---

## Rollback global Sprint 7

**Option 1 — Rollback code (Dokploy) :**
Dokploy > service > Deployments > sélectionner le dernier deploy Sprint 6 stable > Redeploy.
Le code Sprint 6 ignore les tables `briefings` et `meteo_cache` (inconnues de lui).
La ligne crontab `30 6 * * 1 /api/cron/briefing` sera présente dans l'image cron Sprint 7 mais
l'endpoint n'existera plus → curl `-sf` sortira en erreur non-zéro, supercronic loggue l'échec
mais continue — les autres crons (dérives, hebdo) ne sont pas affectés.

**Option 2 — Rollback migrations (si nécessaire) :**
Voir section "Rollback" de `MIGRATION_016_017_APPLY.md`. Ne rollback que si le code est déjà revert.

**Option 3 — Retirer `OPENWEATHER_API_KEY` (si urgence sécurité clé compromise) :**
Dokploy > service > Environment > supprimer la variable > Save > Deploy.
L'app ne redémarrera pas (startup check throw). Générer une nouvelle clé OpenWeather, puis
ré-ajouter dans Dokploy.
