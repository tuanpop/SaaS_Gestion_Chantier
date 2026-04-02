# Roadmap V1

## MoSCoW — MUST HAVE

### Fondations
- Auth + 3 rôles (Admin / Conducteur / Ouvrier)
- Multi-tenant (organisation isolée par client)
- Essai 14 jours sans CB — modèle invitation uniquement

### Chantiers & Tâches
- Création chantier (nom, client, adresse, budget, dates)
- Hiérarchie Chantier → Tâches (pas de Lots)
- Dates d'échéance sur les tâches
- Statuts : À faire / En cours / Terminé / Bloqué
- Attribution tâche à utilisateur

### Équipe & Affectations
- Fiches collaborateurs basiques (nom, prénom, rôle, téléphone)
- Invitation conducteur par email (magic link 48h)
- Création ouvrier sans email (QR code)
- Affectation ouvrier à un chantier (table affectations + champ vue)

### Visibilité dirigeant
- Vue portefeuille multi-chantiers rouge / orange / vert
- Budget mini 3 chiffres (alloué / dépensé / écart)
- Dashboard dirigeant
- Notifs in-app (fil activité + badges)
- Alertes jalons dépassés (in-app)

### Terrain mobile (PWA)
- QR code onboarding ouvrier (< 3 min, sans compte manuel)
- Checklist tâches du jour (1 écran, 2 taps max)
- Photo live caméra + upload depuis galerie
- Commentaire texte court sur photo
- Offline partiel (cache lecture + upload différé)
- Sync automatique au retour réseau

### Reporting
- CR journalier auto-généré (Claude API — Sonnet)
- Workflow validation conducteur (brouillon → validé → envoyé)
- Export PDF template fixe
- Rapport hebdo auto (agrégation 7 CR)

### IA haute valeur
- Détection proactive des dérives (cron + règles métier + message Haiku)
- Briefing automatique lundi matin (cron + OpenWeather + synthèse Sonnet)
- ClawBot par rôle (chat + suggestions + actions avec confirmation)
- Onboarding guidé ouvrier via ClawBot

---

## SHOULD HAVE (V1 si le temps le permet, sinon V2)

- Note vocale sur tâche
- Gantt simplifié
- Calendrier hebdo équipe
- Alertes push (Web Push VAPID)
- Rapport hebdo auto
- Partage client lecture seule
- Rédaction emails client assistée IA
- Analyse post-chantier automatique

---

## WON'T HAVE V1

- Lots (hiérarchie intermédiaire)
- Facturation / devis / bons de commande
- Chat intégré
- Annotation de plans (DWG, PDF)
- Gestion matériel / inventaire
- Incidents & réserves
- Signature électronique
- Pointage / feuilles d'heures RH
- Intégrations ERP / CRM / Sage
- Géolocalisation
- Modèle local LLM (Ollama)
- WhatsApp Business API (V2)
- Capacitor / app native (V2 si trigger atteint)

---

## Ordre des sprints

| Sprint | Semaines | Features | Charge vibecoding |
|---|---|---|---|
| 1 — Fondations | 1-2 | Auth, rôles, multi-tenant, schéma DB, trial 14j | 1.5 sem |
| 2 — Core data | 2-4 | Chantiers, tâches, dates, statuts, attribution, fiches collabs, affectations | 1.5 sem |
| 3 — Mobile terrain | 4-7 | Checklist, photo, QR code, offline, sync | 3 sem |
| 4 — Visibilité | 7-8 | Portefeuille rouge/vert, budget, dashboard, notifs, alertes | 1 sem |
| 5 — Reporting | 8-10 | CR auto, rapport hebdo, workflow validation, PDF | 2 sem |
| 6 — IA dérive | 10-11 | Détection dérives (cron + règles + message LLM) | 1 sem |
| 7 — IA briefing | 11-12 | Briefing lundi matin (cron + OpenWeather + Sonnet) | 0.5 sem |
| 8 — ClawBot | 12-15 | Functions métier, chat par rôle, routing, onboarding ouvrier | 3.5 sem |
| 9 — Polish | 15-17 | Bugfix mobile, tests terrain, edge cases | 2.5 sem |

**MVP pilotes (sans ClawBot) : semaine 11**
**Lancement public : semaine 17**

---

## Métriques de succès V1

| Métrique | Cible 3 mois | Cible 6 mois |
|---|---|---|
| MRR | 500€ (5 clients Starter) | 2 000€ (10-15 clients Pro) |
| Taux adoption ouvriers | > 70% actifs hebdo | > 80% |
| Taux conversion essai → payant | > 20% | > 30% |
| NPS pilotes | > 40 | > 50 |
| Churn mensuel | < 5% | < 3% |
| Coût LLM / MRR | < 15% | < 10% |
