# Points Ouverts — À trancher avant implémentation

Tout item marqué `[ ]` doit être résolu avant le sprint concerné.
Mettre à jour ce fichier au fil des décisions.

---

## Sprint 1

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-001 | Trial expiré : quelle expérience exacte en lecture seule ? (quelles actions bloquées ?) | UX onboarding mal défini | `[ ]` |
| PO-011 | Durée rétention photos = 2 ans ou autre ? Impact coût Supabase Storage. | Non-conformité RGPD ou coût imprévu | `[ ]` |
| PO-012 | Suppression données utilisateur : cascade automatique ou archive logique ? | Non-conformité RGPD droit à l'effacement | `[ ]` |

---

## Sprint 2

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-002 | Seuil coloration orange = 3 jours avant échéance — confirmer ? | Dashboard coloré incorrectement | `[ ]` |
| PO-003 | budget_depense en V1 : saisie manuelle par admin uniquement ou aussi conducteur ? | Module budget inutilisable | `[ ]` |
| PO-004 | Retour d'une tâche de "terminé" vers "en cours" : conducteur uniquement ou aussi l'ouvrier sur sa propre tâche ? | Friction terrain possible | `[ ]` |

---

## Sprint 3

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-005 | Session Redis TTL 7j avec renewal automatique — confirmer pour les ouvriers actifs quotidiennement | Session expirée en usage normal | `[ ]` |
| PO-006 | Vue `chantier_complet` : l'ouvrier voit toutes les tâches avec tous les détails ou seulement titre + statut ? | Scope de la vue à préciser | `[ ]` |
| PO-014 | Vue `chantier_complet` : l'ouvrier peut-il voir les notes privées du conducteur sur une tâche ? | Fuite d'information interne possible | `[ ]` |
| PO-015 | Aucune affectation active au scan QR : afficher le numéro du conducteur ou message simple uniquement ? | UX bloquée sur le terrain | `[ ]` |

---

## Sprint 4

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-007 | Fréquence check alertes jalons = 1h ou 1 fois par jour à 7h ? Impact cron VPS. | Sur-notification ou sous-notification | `[ ]` |

---

## Sprint 5

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-008 | Template PDF CR : inclure le logo de l'entreprise cliente ou logo ClawBTP générique uniquement ? | Perception non professionnelle possible | `[ ]` |
| PO-009 | Relance conducteur si CR non validé en 48h : notification in-app ou email ? | Workflow CR incomplet | `[ ]` |

---

## Sprint 6

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-010 | Seuils dérives (70%/50%, 3j/80%) à valider avec les pilotes terrain | Faux positifs ou faux négatifs | `[ ]` |

---

## Post-pilotes (Sprint 9)

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-016 | Trigger Capacitor : définir les seuils exacts mesurés sur pilotes (% iOS sans push, % cache offline) | Architecture mobile V2 | `[ ]` |

---

## V3

| ID | Question | Impact | Statut |
|---|---|---|---|
| PO-017 | Trigger Flutter : MRR > 5K€/mois ET UX terrain documentée comme frein croissance | V3 — pas bloquant | `[ ]` |
