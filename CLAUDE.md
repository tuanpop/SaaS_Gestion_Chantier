# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Langue

Toutes les conversations, commentaires de code, commits, et réponses doivent être **en français**.

## Projet

ClawBTP — SaaS de gestion de chantier BTP pour PME second oeuvre (15-25 salariés, France). Positionnement : *"Le seul outil BTP que tes ouvriers utilisent vraiment."*

## Stack

- **Frontend** : Next.js 15 App Router + TypeScript + Tailwind CSS + shadcn/ui
- **State client** : TanStack Query v5
- **Backend** : Next.js API Routes (pas de serveur séparé)
- **DB + Auth** : Supabase (PostgreSQL + RLS + Supabase Auth)
- **Auth ouvrier** : Session custom Redis — QR code chiffré AES-256-GCM
- **LLM** : Claude API — Sonnet (CR, synthèse) + Haiku (questions simples, alertes)
- **Hébergement** : VPS Linux — Dokploy + Traefik + Docker Swarm
- **Tests** : Vitest (unit/integ) + Playwright (E2E)
- **Mobile ouvrier** : PWA (manifest + Service Worker + Web Push VAPID)
- **Mobile conducteur** : Web responsive mobile-first (pas de Capacitor)

## Commandes de développement

```bash
npm install          # Installer les dépendances
npm run dev          # Lancer le serveur de développement
npm run build        # Build de production
npm run lint         # Linter
npx vitest           # Lancer tous les tests unitaires/integ
npx vitest run src/lib/foo.test.ts   # Lancer un seul test
npx playwright test  # Lancer les tests E2E
```

## Variables d'environnement

Copier `.env.example` → `.env.local` et remplir. Clés requises :

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_VAPID_KEY` — publiques
- `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `REDIS_URL`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `OPENWEATHER_API_KEY`, `RESEND_API_KEY` — serveur uniquement

## Architecture — Vue d'ensemble

### Multi-tenant

Chaque organisation est isolée. `organisation_id` est présent sur toutes les tables tenant avec un index obligatoire. RLS Supabase filtre côté DB pour admin/conducteur (JWT). Les ouvriers n'ont pas de JWT Supabase — le filtrage est applicatif via la session Redis.

### Auth par rôle

| Rôle | Méthode | Session |
|---|---|---|
| `admin` | Email + Password ou Magic Link | JWT Supabase Auth |
| `conducteur` | Email + Password ou Magic Link | JWT Supabase Auth |
| `ouvrier` | QR code uniquement | Session Redis TTL 7j |

- Inscription publique **désactivée** (`enable_signup = false`) — modèle invitation uniquement
- JWT custom claims : `organisation_id` + `role` injectés via Supabase Auth Hook
- QR code encode `{ user_id, organisation_id }` chiffré AES-256-GCM — un seul QR permanent par ouvrier
- La table `affectations` résout dynamiquement quel(s) chantier(s) sont actifs au moment du scan

### Modèle de données clé

`organisations` → `users` (3 rôles) → `affectations` (lie ouvrier/chantier sur une période) → `chantiers` → `taches` (statut: a_faire|en_cours|termine|bloque) → `photos`. CR journaliers générés par LLM, workflow brouillon → validé → envoyé.

### LLM — Claude API

- Sonnet : CR journaliers, rapport hebdo, briefing lundi matin
- Haiku : ClawBot questions simples, messages d'alerte dérive
- Détection dérives = logique déterministe (pas LLM). Le LLM génère uniquement le message
- Whitelist de fonctions par rôle validée AVANT tout appel Claude API
- `htmlEscape` obligatoire sur tout input utilisateur avant insertion dans le prompt

### Crons (supercronic dans Docker, replicas: 1 obligatoire)

- 18h : génération CR journalier
- 7h : détection dérives
- 7h30 lundi : briefing hebdo
- Toutes les heures : vérification jalons
- Sécurisés par header `x-cron-secret`

## Règles de code — absolues

- Validation **Zod sur 100% des endpoints** API — jamais de `req.body` sans schema
- **RLS activée sur toutes les tables** Supabase dès leur création — index sur `organisation_id` obligatoire
- **Jamais de `NEXT_PUBLIC_`** sur `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `REDIS_URL`, `CRON_SECRET`
- **Jamais de `console.log`** — pino structuré uniquement avec correlation ID
- **`cookies()` et `headers()` sont async** en Next.js 15 — toujours `await`
- `refetchOnWindowFocus: false` sur **toutes les queries TanStack Query mobile**
- Fonctions **< 30 lignes**, imbrication **< 3 niveaux**
- **`any` TypeScript interdit** sans commentaire justificatif
- Selects natifs iOS **interdits** sur mobile — utiliser `Drawer` shadcn/ui
- Boutons tactiles ouvrier : **min 56px hauteur**, espacement **min 8px**
- **2 taps maximum** pour toute action critique ouvrier
- CR auto reste en **brouillon** jusqu'à validation conducteur — jamais d'envoi automatique

## Hors scope V1 — ne pas implémenter

Géolocalisation, chat intégré, facturation/devis, annotation de plans (DWG/PDF), pointage/feuilles d'heures RH, lots, dépendances entre tâches, modèle local LLM (Ollama), push via Capacitor, WhatsApp Business API.

## Docs de référence

| Quand | Lire |
|---|---|
| Début de session ou question "pourquoi" | `docs/VISION.md` |
| Coder une interface (composant, page, flow) | `docs/ux.md` |
| Coder du back (DB, auth, API, sécurité) | `docs/architecture.md` |
| Planning, sprints, métriques | `docs/roadmap.md` |
| Question "pourquoi on a fait ça ?" | `docs/decisions.md` |
| Implémenter une feature | `docs/user-stories/sprint-X.md` |
