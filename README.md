# ClawBTP

SaaS de gestion de chantier BTP — PME second oeuvre 15-25 salariés France.

> "Le seul outil BTP que tes ouvriers utilisent vraiment."

## Stack

| | |
|---|---|
| Frontend | Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui |
| State | TanStack Query v5 |
| Backend | Next.js API Routes |
| DB + Auth | Supabase (PostgreSQL + RLS + Auth) |
| LLM | Claude API (Sonnet + Haiku) |
| Hébergement | VPS Linux — Dokploy + Traefik + Docker Swarm |
| Tests | Vitest + Playwright |
| Mobile ouvrier | PWA (manifest + SW + VAPID) |
| Mobile conducteur | Web responsive mobile-first |

## Docs

| Fichier | Contenu | Lire quand |
|---|---|---|
| `CLAUDE.md` | Stack + règles techniques absolues | Lu automatiquement par Claude Code |
| `docs/VISION.md` | Pourquoi ce produit, pour qui, features signatures | Début de session ou question "pourquoi" |
| `docs/ux.md` | Règles UI/UX par persona, palette, composants | Coder une interface |
| `docs/architecture.md` | Schéma DB, auth, sécurité, patterns de code | Coder du back |
| `docs/roadmap.md` | MoSCoW, sprints, métriques | Planning |
| `docs/decisions.md` | ADR — toutes les décisions actées | Question "pourquoi on a fait ça ?" |
| `docs/points-ouverts.md` | 17 PO à trancher avant chaque sprint | Avant chaque sprint |
| `docs/user-stories/sprint-1.md` | US-001 à US-003 | Implémenter sprint 1 |
| `docs/user-stories/sprint-2.md` | US-004, US-010, US-011 | Implémenter sprint 2 |
| `docs/user-stories/sprint-3-8.md` | US-020 à US-060 | Implémenter sprints 3-8 |

## Démarrage rapide

```bash
git clone https://github.com/ton-org/clawbtp.git
cd clawbtp
cp .env.example .env.local
# Remplir les variables d'environnement
npm install
npm run dev
```

## Variables d'environnement requises

```bash
# Public
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_VAPID_KEY=

# Serveur uniquement
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
REDIS_URL=
CRON_SECRET=
VAPID_PRIVATE_KEY=
OPENWEATHER_API_KEY=
RESEND_API_KEY=
```
