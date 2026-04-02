# ClawBTP — Contexte Claude Code

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

## Règles de code — absolues

- Validation **Zod sur 100% des endpoints** API — jamais de `req.body` sans schema
- **RLS activée sur toutes les tables** Supabase dès leur création — index sur `organisation_id` obligatoire
- **Jamais de `NEXT_PUBLIC_`** sur `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `REDIS_URL`, `CRON_SECRET`
- **Jamais de `console.log`** — pino structuré uniquement avec correlation ID
- **`cookies()` et `headers()` sont async** en Next.js 15 — toujours `await`
- `refetchOnWindowFocus: false` sur **toutes les queries TanStack Query mobile**
- Fonctions **< 30 lignes**, imbrication **< 3 niveaux**
- **`any` TypeScript interdit** sans commentaire justificatif

## Auth par rôle

| Rôle | Méthode | Type de session |
|---|---|---|
| `admin` | Email + Password ou Magic Link | JWT Supabase Auth |
| `conducteur` | Email + Password ou Magic Link | JWT Supabase Auth |
| `ouvrier` | QR code uniquement | Session Redis TTL 7j |

- Inscription publique **désactivée** (`enable_signup = false`)
- Modèle **invitation uniquement** — l'admin crée tous les comptes
- Google OAuth et Facebook OAuth **supprimés**

## Hors scope V1 — ne pas implémenter

- Géolocalisation (aucun persona)
- Chat intégré (WhatsApp imbattable)
- Facturation / devis / bons de commande
- Annotation de plans (DWG, PDF)
- Pointage / feuilles d'heures RH
- Lots (hiérarchie intermédiaire entre chantier et tâche)
- Dépendances entre tâches
- Modèle local LLM (Ollama)
- Push notifications via Capacitor (PWA VAPID suffit en V1)

## Docs de référence

| Quand | Lire |
|---|---|
| Début de session ou question "pourquoi" | `docs/VISION.md` |
| Coder une interface (composant, page, flow) | `docs/ux.md` |
| Coder du back (DB, auth, API, sécurité) | `docs/architecture.md` |
| Implémenter une feature | `docs/user-stories/sprint-X.md` |
