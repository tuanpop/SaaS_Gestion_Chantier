# ClawBTP — Vision Produit

## Le problème

Les PME BTP second oeuvre (15-25 salariés) pilotent leurs chantiers avec Excel, WhatsApp et leur mémoire. Quand ils dépassent 4-5 chantiers simultanés, tout s'effondre : les marges deviennent invisibles, les retards se découvrent trop tard, les ouvriers n'adoptent aucun outil numérique.

> "Je ne sais pas dire si je gagne de l'argent ou pas. Un chantier ça se pilote au moment où ça se passe. Pas trois mois après."
> — Frédéric Sandau, dirigeant charpente 36 sal.

> "Avec Excel, je perdais un temps fou."
> — Flavien, artisan carreleur

**Le chiffre clé** : 66% des chantiers dépassent leur budget de plus de 10%. La dérive est découverte trop tard parce qu'il n'y a pas de visibilité en temps réel.

---

## Ce qu'on construit

Un outil de gestion de chantier mobile-first qui résout **deux problèmes simultanément** :

1. **L'adoption terrain** — les ouvriers n'utilisent aucun outil. On résout ça avec le QR code onboarding : scan → tâches du jour en 90 secondes, sans compte, sans formation.

2. **La visibilité dirigeant** — le dirigeant ne sait pas ce qui se passe sur ses chantiers en temps réel. On résout ça avec le dashboard rouge/vert + les CRs générés automatiquement depuis ce que le terrain saisit.

**Le positionnement** : *"Le seul outil BTP que tes ouvriers utilisent vraiment."*

---

## Les 3 personas

### Admin — Le Dirigeant-Gérant

- 40-55 ans, issu du terrain, passé aux fonctions de direction
- Gère tout depuis son téléphone entre deux chantiers
- Travaille 50+ heures par semaine
- **Douleur principale** : marge invisible, découverte des dérives trop tard
- **Ce qu'il achète** : sérénité + contrôle + temps récupéré le soir
- **Auth** : email + password ou magic link
- **Interface** : dashboard web desktop + responsive

### Conducteur — Le Conducteur de Travaux

- 30-45 ans, mobile, téléphone sonne toutes les 4 minutes
- Interface entre le bureau et les équipes terrain
- **Douleur principale** : passe du temps à appeler pour savoir où en sont les chantiers, ressaisit des données envoyées par SMS
- **Ce qu'il achète** : visibilité temps réel sans décrocher son téléphone
- **Auth** : email + password ou magic link
- **Interface** : web responsive mobile-first irréprochable

### Ouvrier — Le Chef de Chantier / Ouvrier

- 20-55 ans, peu à l'aise avec le numérique, mains occupées
- Ne veut pas apprendre un nouvel outil
- Si l'app demande plus de 3 taps, il revient à WhatsApp
- **Douleur principale** : aucune — il subit le changement, il ne le demande pas
- **Ce qu'il fait** : savoir quoi faire aujourd'hui, cocher terminé, envoyer une photo
- **Auth** : QR code uniquement — pas d'email, pas de mot de passe
- **Interface** : PWA standalone mobile-first

---

## Les 10 features signatures

Ce sont les features qui définissent l'identité du produit. Si l'une est mal exécutée, le positionnement s'effondre.

| # | Feature | Pourquoi intouchable |
|---|---|---|
| 1 | **QR code onboarding ouvrier** | Seul différenciateur prouvable en 90 sec en démo. Aucun concurrent ne le fait. |
| 2 | **CR journalier auto-généré** | ROI immédiat semaine 1. Aucun concurrent TPE ne le fait. |
| 3 | **Checklist tâches 2 taps** | Preuve de l'UX terrain irréprochable. |
| 4 | **Détection proactive des dérives** | Résout le pain point #1 dirigeant — marge invisible. |
| 5 | **Briefing automatique lundi matin** | WOW factor. Aucun concurrent sur ce segment. |
| 6 | **Vue portefeuille rouge/vert** | WOW visuel en démo. Compréhension valeur en 30 secondes. |
| 7 | **Dashboard dirigeant** | Support central de toute la démo. |
| 8 | **ClawBot par rôle** | Différenciation long terme + rétention. |
| 9 | **Onboarding guidé ouvrier ClawBot** | Adoption terrain +20% estimé. |
| 10 | **Workflow validation CR** | Sans lui le CR auto devient la feature de churn #1. |

---

## Ce que ce produit n'est pas

**Pas un ERP.** Pas de facturation, pas de devis, pas de comptabilité. Le dirigeant garde son expert-comptable et son logiciel de facturation.

**Pas un outil de pointage RH.** Pas de gestion des heures, pas de feuilles de paie. Sujet légal complexe (conventions collectives BTP) — hors scope définitif.

**Pas un outil de gestion documentaire.** Pas d'annotation de plans, pas de DWG. Dropbox ou Google Drive couvrent ce besoin.

**Pas un chat.** WhatsApp est ancré dans le comportement terrain. On ne se bat pas contre WhatsApp.

---

## Concurrents principaux

| Concurrent | Force | Faiblesse exploitable |
|---|---|---|
| **Alobees** | Partenariat Sage, distribution | Pas d'automatisation, ergonomie mobile perfectible |
| **Sage Batigest** | Base installée massive | Obsolète, pas d'app mobile native, 1133 avis critiques |
| **PlanRadar** | Plans & réserves | Focalisé docs, pratiques commerciales critiquées |
| **Graneet** | ERP complet, solide | Pas d'app mobile native, prix élevé |
| **Obat** | Simple, facturation | Focalisé facturation, pas de gestion terrain |

**Notre angle** : Alobees ne résout pas l'adoption terrain et n'automatise rien. C'est là qu'on gagne.

---

## Pricing

| Plan | Prix | Users inclus | Cible |
|---|---|---|---|
| Starter | 49€ HT/mois | 5 users | Test marché |
| Pro | 99€ HT/mois | 15 users | Coeur de cible (PME 15-20 sal.) |
| Business | 179€ HT/mois | 30 users | PME 20-35 sal. |

- Essai gratuit 14 jours, sans CB
- Réduction 20% à l'engagement annuel
- Au-delà de 30 users : sur devis

---

## Roadmap mobile

| Version | Technologie | Trigger |
|---|---|---|
| V1 | PWA (manifest + SW + VAPID) | En production |
| V2 | Capacitor (wrapper PWA) | > 30% ouvriers iOS sans push OU > 20% problèmes cache offline |
| V3 | Flutter (réécriture UI ouvrier) | MRR > 5K€/mois ET UX documentée comme frein croissance |
