# Decisions — Architecture Decision Records

Toutes les décisions actées. Ne pas revenir dessus sans raison documentée.

---

## ADR-001 — Pas de Google/Facebook OAuth

**Décision** : Google OAuth et Facebook OAuth supprimés.
**Raison** : Non pertinent PME BTP. Un ouvrier de 45 ans n'a pas de Google Workspace. Friction inutile sur une cible peu digitale.
**Auth retenu** : Email + Password ou Magic Link pour admin/conducteur. QR code uniquement pour les ouvriers.

---

## ADR-002 — Inscription publique désactivée

**Décision** : `enable_signup = false` dans Supabase Auth. Modèle invitation uniquement.
**Raison** : Contrôle total sur les organisations créées. Évite les comptes orphelins. Cohérent avec le modèle B2B PME.

---

## ADR-003 — QR code lié à l'ouvrier, pas au chantier

**Décision** : Le QR code encode `{ user_id, organisation_id }` chiffré AES-256-GCM. Un seul QR permanent par ouvrier.
**Raison** : Un QR par chantier obligerait l'ouvrier à avoir un nouveau QR à chaque affectation. La table `affectations` résout dynamiquement quel(s) chantier(s) sont actifs au moment du scan.
**Impact** : Table `affectations` ajoutée au schéma avec champ `vue` (mes_taches | chantier_complet).

---

## ADR-004 — Pas de serveur séparé (Next.js API Routes)

**Décision** : Backend = Next.js API Routes dans le même projet.
**Raison** : YAGNI. Pour un solopreneur en vibecoding, un seul repo, un seul déploiement, un seul contexte. Pas de tRPC en V1.
**Condition de révision** : Si les API Routes deviennent un goulot d'étranglement avec > 100 req/s simultanées.

---

## ADR-005 — PWA pour l'ouvrier (pas Capacitor)

**Décision** : Interface ouvrier = PWA (manifest + Service Worker + Web Push VAPID).
**Raison** : QR code → URL → opérationnel immédiatement, sans App Store. Usage quotidien = cache jamais expiré. Mises à jour instantanées sans review Apple.
**Trigger Capacitor V2** : > 30% ouvriers iOS sans push OU > 20% problèmes cache offline mesurés sur les pilotes terrain.
**Trigger Flutter V3** : MRR > 5K€/mois ET UX documentée comme frein à la croissance.

---

## ADR-006 — Conducteur sur web responsive (pas Capacitor)

**Décision** : Interface conducteur = app web responsive mobile-first. Pas de Capacitor.
**Raison** : Le conducteur accède depuis son navigateur mobile. Les features nécessaires (CR, tâches, ClawBot) fonctionnent bien en web. Pas besoin de caméra native ni de push FCM pour ce persona.
**Contrainte** : UX doit être irréprochable — bottom nav bar, Drawer shadcn/ui, TanStack Query tuné.

---

## ADR-007 — Validation CR humaine obligatoire avant envoi

**Décision** : Le CR journalier auto-généré reste en statut "brouillon" jusqu'à validation explicite du conducteur. Jamais d'envoi automatique direct.
**Raison** : Si le CR auto est de mauvaise qualité (données terrain insuffisantes) et part directement au client, la feature de rétention #1 devient la feature de churn #1.
**Impact** : Workflow brouillon → validé → envoyé obligatoire. L'UI bloque tout bypass.

---

## ADR-008 — Détection dérives = logique métier déterministe, pas LLM

**Décision** : La détection des dérives (budget > 70% ET avancement < 50%) est du code déterministe. Le LLM (Haiku) génère uniquement le message d'alerte.
**Raison** : Déléguer la décision d'alerte au LLM génère des faux positifs imprévisibles qui détruisent la confiance du dirigeant.

---

## ADR-009 — VPS Dokploy + Docker Swarm (pas Vercel)

**Décision** : Hébergement sur VPS Linux via Dokploy + Traefik + Docker Swarm.
**Impacts** :
- Crons via supercronic dans Docker Swarm (replicas: 1 obligatoire)
- Streaming ClawBot via SSE natif Next.js (pas de limite 10s Vercel Edge)
- Rate limiting via Redis self-hosted dans le Swarm

---

## ADR-010 — Keycloak reporté en V2

**Décision** : Supabase Auth hosted suffit pour V1. Keycloak prévu pour V2 si clients PME 30+ avec AD/LDAP ou Google Workspace managé.
**Migration** : Supabase Auth supporte OIDC externe. Keycloak sera branché comme provider OIDC sans refaire l'auth.
**Impact V1** : aucun.

---

## ADR-011 — Géolocalisation hors scope V1 et V2

**Décision** : Aucune géolocalisation pour aucun persona.
**Raison** : Sujets RGPD complexes (tracking continu = données sensibles + consentement explicite). Pas un critère d'achat documenté sur la cible V1.

---

## ADR-012 — WhatsApp ClawBot SHOULD V2

**Décision** : WhatsApp Business API pour ClawBot conducteur = hors scope V1.
**Raison** : Nécessite compte Meta Business vérifié (délai imprévisible), numéro dédié, templates approuvés par Meta. Risque de bloquer le lancement.
**V2** : Le code ClawBot existant se réutilise à 80%.
