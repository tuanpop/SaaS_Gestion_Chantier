# Production State — ClawBTP preview
*Source de vérité de l'état déployé réel | Dernière mise à jour : 2026-05-18*

> Ce fichier décrit l'**état réel** de l'infra de preview en production.
> Il complète et **supplante** le `README.md` initial (qui décrivait un déploiement Docker Swarm direct théorique non utilisé).
> À lire en priorité pour toute intervention infra/deploy.

---

## URLs

| Service | URL | Notes |
|---------|-----|-------|
| App preview prod | https://saas-gestion-chantier.tanren-studio.com | SSL Let's Encrypt R12, expire 2026-08-15 |
| Health check | https://saas-gestion-chantier.tanren-studio.com/api/health | Retourne `{"data":{"status":"ok",...}}` |
| Dokploy UI | https://dokploy.tanren-studio.com | HTTPS, port 3000 fermé côté VPS |
| Repo source | https://github.com/tuanpop/SaaS_Gestion_Chantier | branche `main`, auto-deploy actif |

---

## VPS

| Champ | Valeur |
|-------|--------|
| Hébergeur | OVH |
| IP | `149.202.57.242` |
| OS | Ubuntu 26.04 LTS (Resolute Raccoon) |
| Ressources | 11 Go RAM, 96 Go disque, 2 vCPU |
| User SSH | `ubuntu` (sudoer NOPASSWD) |
| Port SSH | **50000** (custom, pas 22) |
| Clé SSH locale | `C:\Users\Tuan\.ssh\ssh-149.202.57.242` (privée) + `.pub` (publique sur le VPS) |
| Commande de connexion | `ssh -i C:\Users\Tuan\.ssh\ubuntu@149.202.57.242 ubuntu@149.202.57.242 -p 50000` |

### Firewall UFW (état au 2026-05-18)
```
50000/tcp  ALLOW IN  # SSH custom
80/tcp     ALLOW IN  # HTTP (Traefik → redirect HTTPS)
443/tcp    ALLOW IN  # HTTPS (Traefik)
```
**Pas de 3000** : Dokploy UI accessible uniquement via Traefik sur le domaine dédié.

---

## Stack de déploiement réel

**PaaS** : Dokploy v0.29.4 (self-hosted, install via `curl https://dokploy.com/install.sh | sudo env ADVERTISE_ADDR=149.202.57.242 sh`)
**Orchestrateur** : Docker Swarm (init `--advertise-addr 149.202.57.242`)
**Reverse proxy** : Traefik (intégré Dokploy)
**SSL** : Let's Encrypt via Traefik (HTTP-01 challenge → Cloudflare DOIT être en DNS only, pas proxy orange — D-030)
**Docker** : v29.5.0 (installé manuellement via apt sans pin de version — Ubuntu 26.04 `resolute` pas dans l'index Docker au moment de l'install ; l'installeur Dokploy plante sinon)

### Services Docker Swarm
```
dokploy                          1/1   dokploy/dokploy:v0.29.4
dokploy-postgres                 1/1   postgres:16        # DB interne Dokploy
dokploy-redis                    1/1   redis:7            # Redis interne Dokploy
saasgestionchantierapp-pyaqvf    1/1   saasgestionchantierapp-pyaqvf:latest
saasgestionchantierredis         1/1   redis:7-alpine     # Redis applicatif ClawBTP (auth obligatoire)
```

---

## DNS

| Record | Type | Valeur | Proxy |
|--------|------|--------|-------|
| `saas-gestion-chantier.tanren-studio.com` | A | 149.202.57.242 | **DNS only (gris)** |
| `dokploy.tanren-studio.com` | A | 149.202.57.242 | **DNS only (gris)** |

⚠️ **Cloudflare proxy orange = INTERDIT** sur ces records — casse HTTP-01 Let's Encrypt + double SSL. Voir D-030.

---

## Build & deploy

### Configuration Dokploy `clawbtp-app`
| Champ | Valeur |
|-------|--------|
| Source | Github App "Dokploy" sur `tuanpop/SaaS_Gestion_Chantier` |
| Branch | `main` |
| **Build Path** | `artifacts/07-code` |
| **Dockerfile** | `Dockerfile` (à la racine du Build Path — D-026) |
| Auto Deploy | ON (push `main` déclenche un rebuild) |

### Configuration Dokploy `clawbtp-redis`
| Champ | Valeur |
|-------|--------|
| Image | `redis:7-alpine` |
| Database password | Auto-généré Dokploy, stocké dans gestionnaire de mdp |
| External Port | Non exposé (réseau Docker interne uniquement) |
| Hostname interne | `saasgestionchantierredis` (résolu par Docker Swarm DNS) |

### Pipeline
1. `git push origin main` → GitHub Actions CI tourne (tsc + lint + vitest)
2. Webhook GitHub App → Dokploy → clone repo
3. `docker build -t saasgestionchantierapp-pyaqvf:latest -f Dockerfile .` (dans Build Path)
4. Rolling update du service Docker Swarm (`start-first`, zero-downtime)
5. Traefik route automatiquement → cert renouvelé si proche expiration

Durée totale typique : **~4-5 min** sur ce VPS.

### ⚠️ `npm run build` PAS dans le CI actuel
À ajouter en urgence (cf. D-031, GAP-next-build-CI). 4 bugs Sprint 2 sont passés en prod faute de cette étape : route groups conflict, RSC handler dans Server Component, page `/` manquante, dossier `public/` absent.

---

## Variables d'environnement Dokploy

### Onglet Environment (runtime container — 14 vars)
| Variable | Source / Notes |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Settings → API → anon public |
| `NEXT_PUBLIC_APP_URL` | `https://saas-gestion-chantier.tanren-studio.com` |
| `NEXT_PUBLIC_VAPID_KEY` | `placeholder` (Sprint 3+) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Settings → API → service_role secret ⚠️ |
| `REDIS_URL` | `redis://default:<password>@saasgestionchantierredis:6379` |
| `RESEND_API_KEY` | resend.com/api-keys |
| `QR_ENCRYPTION_KEY` | 64 chars hex — généré une fois, NE JAMAIS changer (invaliderait tous les QR ouvriers) |
| `CRON_SECRET` | 64 chars hex — généré une fois |
| `ANTHROPIC_API_KEY` | `placeholder` (Sprint 5+) |
| `VAPID_PRIVATE_KEY` | `placeholder` (Sprint 3+) |
| `OPENWEATHER_API_KEY` | `placeholder` (Sprint 5+) |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `NODE_ENV` | `production` |

### Onglet Build-time Arguments (compile-time — 4 vars)
**OBLIGATOIRE** — Next.js standalone inline ces vars au compile-time (D-027) :
```
NEXT_PUBLIC_SUPABASE_URL=<idem Environment>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<idem Environment>
NEXT_PUBLIC_APP_URL=https://saas-gestion-chantier.tanren-studio.com
NEXT_PUBLIC_VAPID_KEY=placeholder
```

⚠️ **Une nouvelle var `NEXT_PUBLIC_*` doit être ajoutée DANS LES DEUX ONGLETS** + déclarée comme `ARG` dans le Dockerfile.

---

## Supabase

| Champ | Valeur |
|-------|--------|
| Région | `eu-west` (Paris) |
| Plan | Free (pilote) |
| Migrations appliquées | 001_initial_schema.sql + 002_chantiers_taches.sql |
| Auth hook | `Customize Access Token (JWT) Claims hook` → type Postgres → schema `public` → function `custom_access_token_hook` |
| enable_signup | OFF (D-002) — signup via admin API uniquement |
| Automatically expose new tables | **OFF** — GRANTs manuels obligatoires sur futures tables (D-029) |
| GRANTs appliqués | `service_role` ALL + `authenticated` SELECT/INSERT/UPDATE/DELETE sur les 5 tables Sprint 1+2 + `ALTER DEFAULT PRIVILEGES IN SCHEMA public` pour les futures tables |

### RLS — convention binding (D-028)
Toutes les policies isolation_org lisent le claim depuis `app_metadata` :
```sql
((auth.jwt() -> 'app_metadata') ->> 'organisation_id')::uuid
```
**JAMAIS** `auth.jwt() ->> 'organisation_id'` (top-level — retourne NULL avec le hook PG actuel).

---

## Opérations courantes

### Voir les logs app
```bash
sudo docker service logs saasgestionchantierapp-pyaqvf --tail 100 --follow
```

### Voir les logs build Dokploy
UI Dokploy → service `clawbtp-app` → **Deployments** → cliquer sur le dernier build.

### Redéployer manuellement (sans push)
UI Dokploy → service `clawbtp-app` → **Deploy** ou **Rebuild without cache** (force un rebuild Docker propre).

### Rollback
UI Dokploy → service `clawbtp-app` → **Deployments** → cliquer sur une ancienne version → **Redeploy**.

### Modifier une env var
Dokploy → service → Environment → modifier → **Save** → **Deploy** (les vars sont réinjectées au prochain démarrage du container ; pour les `NEXT_PUBLIC_*`, modifier AUSSI dans Build-time Arguments + **Rebuild without cache**).

### Flush Redis applicatif (cache trial-gate, rate limits)
```bash
# En SSH sur le VPS
APP=$(sudo docker ps --format '{{.Names}}' | grep saasgestionchantierapp | head -1)
# Récupérer password depuis l'inspect ou l'URL Redis dans Dokploy
# Puis :
sudo docker exec $(sudo docker ps --format '{{.Names}}' | grep saasgestionchantierredis | head -1) \
  redis-cli --user default -a "<PASSWORD>" --no-auth-warning FLUSHDB
```
Note : cache trial-gate a TTL 60s — il s'invalide naturellement.

### Renouveler le cert SSL
Automatique via Traefik. Le cert se renouvelle ~30 jours avant expiration. Pas d'intervention nécessaire.

### Modifier une migration Supabase
1. Modifier le fichier dans `artifacts/07-code/supabase/migrations/`
2. **Local** : `cd artifacts/07-code && npx supabase db push --linked`
3. Si la migration touche une table déjà existante avec data : préférer une nouvelle migration `003_*.sql` que la modification rétroactive.

---

## Coût mensuel actuel

| Poste | Coût |
|-------|------|
| VPS OVH | ~6-10 EUR/mois |
| Supabase Free | 0 EUR (500 Mo DB, 50k MAU) |
| Cloudflare DNS | 0 EUR |
| GitHub | 0 EUR (repo public ou Free) |
| Domaine `tanren-studio.com` | ~10 EUR/an |
| Resend Free | 0 EUR (100 emails/jour) |
| **Total preview pilote** | **~10 EUR/mois** |

À prévoir pour la commercialisation : Supabase Pro (25 USD/mois) + monitoring (UptimeRobot Free OK pour pilote).

---

## Pièges connus (à NE PAS oublier)

1. **Ubuntu 26.04 + script d'install Dokploy** : Docker version pin échoue (pas dans index Docker). Installer Docker manuellement via apt sans pin **puis** relancer `curl install.sh | sudo env ADVERTISE_ADDR=<IP> sh`.
2. **Cloudflare proxy orange** : INTERDIT sur les records prod (casse Let's Encrypt + double SSL). DNS only obligatoire.
3. **NEXT_PUBLIC_* Next.js standalone** : inline au compile-time. Mettre en Build-time Arguments OBLIGATOIRE, pas seulement Environment.
4. **Dockerfile Path Dokploy** : `..` ne fonctionne pas. Dockerfile doit être DANS le Build Path.
5. **RLS + custom_access_token_hook** : claim dans `app_metadata`, pas top-level. Policies doivent lire via `auth.jwt() -> 'app_metadata' ->> 'organisation_id'`.
6. **Supabase auto-expose OFF** : pas de GRANT auto sur futures tables. À ajouter dans chaque migration.
7. **`tsc` ne suffit pas en validation locale** : ajouter `npm run build` (next build) — détecte les bugs RSC + routing que `tsc` rate.
8. **Suppression du port 3000** : si tu te fais lockout, réouvre avec `sudo ufw allow 3000/tcp && sudo docker service update --publish-add 'published=3000,target=3000,mode=host' dokploy`.

---

## Historique des fixes apportés en prod (2026-05-18)

Voir détails dans `memory/PROJECT_STATE.md` section "Bugs Sprint 2 corrigés en deploy 2026-05-18".

Commits de fix sur `main` :
- `infra: dockerfile + dockerignore dans artifacts/07-code/ pour build Dokploy mono-context`
- `fix(routing): renomme (admin)/(conducteur) en admin/conducteur`
- `fix(docker): cree public/ vide pour COPY du Dockerfile`
- `fix(routing): page racine redirige selon role JWT`
- `fix(rsc+rls): archive-button client component + RLS lit app_metadata`

Patch SQL appliqué en prod (idempotent, à rejouer si recréation projet Supabase) :
```sql
-- GRANTs explicites + ALTER DEFAULT PRIVILEGES (auto-expose désactivé)
GRANT ALL PRIVILEGES ON public.organisations, public.users, public.chantiers, public.affectations, public.taches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisations, public.users, public.chantiers, public.affectations, public.taches TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role, authenticated;
```
Les patches RLS (5 policies) sont désormais dans les migrations 001/002 du repo — ne pas rejouer si la migration est appliquée.
