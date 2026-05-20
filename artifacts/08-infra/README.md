# Guide de déploiement — ClawBTP (initial Tanjiro)
*Generé: 2026-05-14 | Stack: Next.js 15 SSR + Redis + supercronic | Cible: VPS Linux + Docker Swarm + Traefik*

---

> ⚠️ **Ce document décrit le déploiement Docker Swarm direct (sans Dokploy) initialement prévu par Tanjiro.**
> **Il n'est PAS l'état réel de la prod preview.** L'app tourne en réalité via **Dokploy v0.29.4** depuis 2026-05-18.
> **Source de vérité de l'état actuel : [`PRODUCTION_STATE.md`](./PRODUCTION_STATE.md)** — à lire en priorité pour toute intervention.
> Ce README reste comme référence de l'option "Docker Swarm direct" au cas où on basculerait hors de Dokploy un jour.

---

## Prérequis

- [ ] VPS Linux Ubuntu 24.04 LTS (OVH VPS Value ou supérieur — 2 vCPU, 4 Go RAM minimum)
- [ ] Docker Engine 27+ et Docker Swarm initialisé (`docker swarm init`)
- [ ] Accès SSH avec clé RSA/ED25519 sans passphrase pour le compte `deploy`
- [ ] Domaine DNS pointant sur l'IP du VPS (`app.clawbtp.fr` -> IP VPS)
- [ ] Projet Supabase créé sur supabase.com (migrations appliquées)
- [ ] Compte GHCR actif (inclus avec GitHub — pas de coût supplémentaire)
- [ ] Port 80 et 443 ouverts dans le pare-feu du VPS

---

## Etape 1 — Preparer le VPS (une seule fois)

```bash
# Connexion SSH
ssh root@VPS_IP

# Creer un utilisateur deploy non-root
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
# Copier votre clé publique dans /home/deploy/.ssh/authorized_keys

# Creer le dossier de config
mkdir -p /opt/clawbtp
chown deploy:deploy /opt/clawbtp
```

## Etape 2 — Initialiser Docker Swarm

```bash
ssh deploy@VPS_IP

# Initialiser Swarm (noeud manager unique en pilote)
docker swarm init --advertise-addr VPS_IP

# Creer le reseau public Traefik (externe au stack)
docker network create --driver=overlay traefik_public
```

## Etape 3 — Copier docker-compose.yml sur le VPS

```bash
# Depuis votre machine locale
scp artifacts/08-infra/docker-compose.yml deploy@VPS_IP:/opt/clawbtp/docker-compose.yml

# Remplacer GITHUB_ORG par votre organisation GitHub dans le fichier
ssh deploy@VPS_IP
sed -i 's/GITHUB_ORG/votre-org-github/g' /opt/clawbtp/docker-compose.yml
```

## Etape 4 — Creer les Docker secrets (une seule fois)

```bash
ssh deploy@VPS_IP

# Format : echo "valeur" | docker secret create nom_secret -
# Ne pas mettre de retour a la ligne dans la valeur (printf sans \n)

printf 'https://VOTRE_REF.supabase.co' | docker secret create next_public_supabase_url -
printf 'eyJ...' | docker secret create next_public_supabase_anon_key -
printf '' | docker secret create next_public_vapid_key -
printf 'eyJ...' | docker secret create supabase_service_role_key -

# Generer QR_ENCRYPTION_KEY : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
printf 'VOTRE_32_BYTES_HEX_64_CHARS' | docker secret create qr_encryption_key -

# Generer CRON_SECRET : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
printf 'VOTRE_CRON_SECRET' | docker secret create cron_secret -

# Sprint 5+ (laisser vide pour Sprint 1 — creer le secret vide)
printf '' | docker secret create anthropic_api_key -
printf '' | docker secret create vapid_private_key -
printf '' | docker secret create openweather_api_key -
printf 'VOTRE_RESEND_API_KEY' | docker secret create resend_api_key -
```

**Important** : les secrets Docker sont immuables. Pour modifier un secret, supprimer le service, supprimer le secret (`docker secret rm nom`), recreer le secret, redéployer.

## Etape 5 — Modifier next.config.js (CRITIQUE)

Le Dockerfile utilise `output: 'standalone'` de Next.js. **Sans ce flag, le build echouera.**

Ajouter dans `next.config.js` :

```js
const nextConfig = {
  output: 'standalone',   // AJOUTER CETTE LIGNE
  async headers() { ... },
  // ...
}
```

Committer et pousser avant le premier deploiement.

## Etape 6 — Configurer les secrets GitHub Actions

Dans GitHub > Settings > Secrets > Actions, creer :

| Nom | Valeur |
|-----|--------|
| `DEPLOY_HOST` | IP du VPS (ex: `51.75.X.X`) |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Contenu de la cle privee SSH du compte `deploy` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://VOTRE_REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` |
| `NEXT_PUBLIC_APP_URL` | `https://app.clawbtp.fr` |

## Etape 7 — Premier deploiement

```bash
# Push sur main declenche le pipeline automatiquement
git push origin main

# Suivre le pipeline dans GitHub > Actions
# Duree attendue : ~4-6 minutes (build Next.js standalone)
```

## Etape 8 — Verifier le deploiement

```bash
# Health check public
curl https://app.clawbtp.fr/api/health
# Reponse attendue : {"data":{"status":"ok","timestamp":"...","version":"0.1.0"}}

# Etat du Swarm depuis le VPS
ssh deploy@VPS_IP
docker service ls
# Attendu :
# clawbtp_app      replicated   2/2    ghcr.io/.../clawbtp:SHA
# clawbtp_cron     replicated   1/1    ghcr.io/.../clawbtp-cron:SHA
# clawbtp_redis    replicated   1/1    redis:7-alpine
# clawbtp_traefik  replicated   1/1    traefik:v3.3

# Logs app en temps reel
docker service logs clawbtp_app --follow --tail 50

# Logs cron
docker service logs clawbtp_cron --follow --tail 20
```

## Etape 9 — Appliquer les migrations Supabase

Les migrations sont appliquees sur Supabase hosted — pas dans Docker.

```bash
# Depuis votre machine locale avec supabase CLI
npx supabase db push --linked
# OU via le dashboard Supabase > SQL Editor
```

## Etape 10 — Configurer l'auth hook Supabase

L'auth hook injecte `organisation_id` et `role` dans les JWT claims. Sans cela, toutes les requetes authentifiees retournent 401.

1. Dashboard Supabase > Authentication > Hooks
2. Hook type : `JWT Claims`
3. Edge Function : `auth-hook` (deployer depuis `artifacts/07-code/supabase/functions/auth-hook.ts`)

```bash
npx supabase functions deploy auth-hook --linked
```

---

## Operations courantes

### Deployer une nouvelle version

```bash
# Push sur main — le pipeline CI/CD se charge du reste
git push origin main
# GitHub Actions : lint -> tests -> build Docker -> push GHCR -> deploy Swarm
```

### Rollback

```bash
ssh deploy@VPS_IP

# Lister les images disponibles sur le noeud
docker image ls ghcr.io/GITHUB_ORG/clawbtp

# Rollback vers un SHA precedent
IMAGE_TAG=SHA_PRECEDENT \
  docker stack deploy \
    --with-registry-auth \
    --prune \
    -c /opt/clawbtp/docker-compose.yml \
    clawbtp

# Verifier
docker service ls
curl https://app.clawbtp.fr/api/health
```

### Voir les logs

```bash
ssh deploy@VPS_IP

# App (toutes les instances)
docker service logs clawbtp_app --follow --tail 100

# Cron
docker service logs clawbtp_cron --follow --tail 50

# Redis
docker service logs clawbtp_redis --tail 20

# Filtrer par correlationId (logs pino structures JSON)
docker service logs clawbtp_app --raw 2>&1 | grep '"correlationId":"UUID_ICI"'
```

### Redemarrer un service sans redeployer

```bash
ssh deploy@VPS_IP

# Force re-creation des tasks (equivalent restart)
docker service update --force clawbtp_app
docker service update --force clawbtp_cron
```

### Verifier Redis

```bash
ssh deploy@VPS_IP

# Shell Redis dans le container
docker exec -it $(docker ps -q -f name=clawbtp_redis) redis-cli

# Dans redis-cli :
PING                    # PONG
KEYS session:*          # Sessions ouvriers actives
DBSIZE                  # Nombre de cles total
INFO memory             # Usage memoire
```

### Mettre a jour un Docker secret

```bash
ssh deploy@VPS_IP

# 1. Scaler app a 0 (pour liberer le secret)
docker service scale clawbtp_app=0 clawbtp_cron=0

# 2. Supprimer l'ancien secret
docker secret rm nom_du_secret

# 3. Recreer avec la nouvelle valeur
printf 'nouvelle_valeur' | docker secret create nom_du_secret -

# 4. Redéployer
IMAGE_TAG=latest \
  docker stack deploy --with-registry-auth --prune -c /opt/clawbtp/docker-compose.yml clawbtp
```

---

## Variables d'environnement — reference complete

| Variable | Ou la definir | Obligatoire Sprint 1 |
|----------|---------------|----------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Docker secret + GitHub Actions secret | Oui |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Docker secret + GitHub Actions secret | Oui |
| `NEXT_PUBLIC_APP_URL` | `docker-compose.yml` env + GitHub Actions secret | Oui |
| `NEXT_PUBLIC_VAPID_KEY` | Docker secret | Non (Sprint 3+) |
| `SUPABASE_SERVICE_ROLE_KEY` | Docker secret uniquement | Oui |
| `REDIS_URL` | `docker-compose.yml` env (`redis://redis:6379`) | Oui |
| `QR_ENCRYPTION_KEY` | Docker secret uniquement | Oui |
| `CRON_SECRET` | Docker secret uniquement | Oui (Sprint 1 ready) |
| `ANTHROPIC_API_KEY` | Docker secret uniquement | Non (Sprint 5+) |
| `VAPID_PRIVATE_KEY` | Docker secret uniquement | Non (Sprint 3+) |
| `OPENWEATHER_API_KEY` | Docker secret uniquement | Non (Sprint 5+) |
| `RESEND_API_KEY` | Docker secret uniquement | Oui (emails invite) |

**Regle absolue** : aucune variable sensible (suffixe absent de `NEXT_PUBLIC_`) ne doit apparaitre dans `docker-compose.yml` en clair. Utiliser Docker secrets exclusivement.

---

## Monitoring de base

```bash
# Etat global du Swarm
ssh deploy@VPS_IP "docker service ls"

# Health check depuis l'exterieur (a integrer dans UptimeRobot / Better Uptime)
curl https://app.clawbtp.fr/api/health

# Utilisation ressources des containers
ssh deploy@VPS_IP "docker stats --no-stream"

# Espace disque (images Docker + volumes)
ssh deploy@VPS_IP "docker system df"

# Nettoyer les images non utilisees (a faire periodiquement)
ssh deploy@VPS_IP "docker image prune -f --filter 'until=168h'"
```

**UptimeRobot (gratuit)** : configurer un moniteur HTTP sur `https://app.clawbtp.fr/api/health` toutes les 5 minutes.

---

## Cout mensuel estime

| Ressource | Cout |
|-----------|------|
| VPS OVH Value (2 vCPU, 4 Go) | ~6 EUR/mois |
| Supabase (Pro plan recommande en prod) | ~25 USD/mois |
| Resend (10k emails/mois gratuit) | 0 EUR/mois (pilote) |
| GHCR (packages publics ou prive < 500 Mo) | 0 EUR/mois |
| Domaine + DNS | ~10 EUR/an |
| **Total pilote (1-5 clients)** | **~35 EUR/mois** |

---

## Points d'attention avant la premiere mise en production

- [ ] `output: 'standalone'` ajoute dans `next.config.js` (Etape 5)
- [ ] Auth hook Supabase deploye et configure (Etape 10)
- [ ] Migrations Supabase appliquees (`001_initial_schema.sql`)
- [ ] `enable_signup=false` dans Supabase Auth > Settings (D-002)
- [ ] Tous les Docker secrets crees sur le VPS (Etape 4)
- [ ] DNS propague (verifier avec `dig app.clawbtp.fr`)
- [ ] Certificat TLS Let's Encrypt emis (Traefik le fait automatiquement au premier demarrage)
- [ ] Smoke test `/api/health` retourne HTTP 200
