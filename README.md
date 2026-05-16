# ClawBTP

SaaS B2B de gestion chantier pour PME du second oeuvre BTP.

## Stack

- **Frontend** : Next.js 15 (App Router, React 19, Server Components)
- **Backend** : API Routes Next.js + Supabase (Postgres + Auth + RLS)
- **Cache / Sessions** : Redis (ioredis)
- **Tests** : Vitest (unit) + Playwright (E2E)
- **Validation** : Zod
- **UI** : Tailwind + shadcn/ui (Radix UI primitives)
- **LLM** : Anthropic Claude (extraction actions chat, CR, briefing) — Sprint 4+
- **Email** : Resend
- **Logs** : Pino

## Structure du repo

```
artifacts/07-code/          ← Application Next.js (racine npm)
  app/                      ← App Router (admin, conducteur, api)
  components/               ← Composants partagés
  lib/                      ← Logique métier, supabase, redis, trial-gate
  supabase/migrations/      ← Migrations SQL (001, 002, ...)
  tests/                    ← Vitest unit + Playwright E2E
  package.json

artifacts/08-infra/         ← Dockerfile, docker-compose, crontab
  Dockerfile
  Dockerfile.cron
  docker-compose.yml
  crontab

.github/workflows/          ← CI GitHub Actions
```

## Démarrage local

```bash
cd artifacts/07-code
npm install
cp .env.example .env.local   # puis remplir les valeurs
npm run dev
```

## Commandes

| Commande         | Action                               |
|------------------|--------------------------------------|
| `npm run dev`    | Dev server Next.js (port 3000)       |
| `npm run build`  | Build production (mode standalone)   |
| `npm run start`  | Démarrer le build production         |
| `npm run lint`   | ESLint                               |
| `npm test`       | Vitest unit tests                    |
| `npm run test:e2e` | Playwright E2E                     |

## Déploiement

Cible : VPS Linux + Dokploy + Traefik + Docker Swarm (voir `artifacts/08-infra/`).

## Status

Sprint 2 livré — core métier chantiers/tâches/affectations.
