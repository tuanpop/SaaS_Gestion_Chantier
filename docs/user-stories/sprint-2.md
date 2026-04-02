# Sprint 2 — Core Chantiers, Tâches & Affectations

## US-004 — Affecter un ouvrier à un chantier

**En tant que** conducteur de travaux (rôle conducteur)
**Je veux** affecter un ouvrier à un chantier pour une période donnée et choisir sa vue
**Afin de** que l'ouvrier voit automatiquement ses tâches dès qu'il scanne son QR code

### Scénario 1 — Affectation nominale
```
GIVEN le conducteur est sur la page équipe du chantier Leclerc
WHEN il sélectionne Mohamed, date_debut = 14/04, date_fin = 28/04, vue = mes_taches
  AND valide
THEN l'affectation est créée
  AND dès le 14/04 au scan QR, Mohamed voit ses tâches Leclerc
```

### Scénario 2 — Ouvrier sur 2 chantiers le même jour
```
GIVEN Mohamed a 2 affectations actives aujourd'hui : Leclerc et Bouchard
WHEN il scanne son QR
THEN sélecteur affiché : 'Sur quel chantier es-tu aujourd'hui ?'
  AND il choisit Leclerc → ses tâches Leclerc s'affichent selon sa vue
```

### Scénario 3 — Aucune affectation active
```
GIVEN Mohamed n'a aucune affectation active aujourd'hui
WHEN il scanne son QR
THEN message : 'Tu n'es affecté à aucun chantier aujourd'hui.'
  AND [voir PO-015 pour le contact conducteur]
  AND aucune donnée de chantier n'est affichée
```

**DoD** : Table affectations créée avec RLS + index · Sélecteur si 2+ affectations actives · Test : conducteur ne peut pas affecter un ouvrier d'une autre organisation

**Complexité** : M | **Points** : 3

---

## US-010 — Créer et piloter un chantier

**En tant que** dirigeant-gérant (rôle admin)
**Je veux** créer un chantier avec ses informations principales et suivre son avancement
**Afin de** avoir une vue centralisée et ne plus jongler entre Excel et WhatsApp

### Scénario 1 — Création et portefeuille
```
GIVEN le dirigeant clique 'Nouveau chantier'
WHEN il saisit : nom, client, adresse, code postal, budget, date début, date fin prévue
  AND valide
THEN chantier créé avec statut actif
  AND apparaît dans le portefeuille avec coloration selon les seuils [voir PO-002]
  AND budget_ecart = budget_alloue (budget_depense = 0 à la création)
```

### Scénario 2 — Validation champs
```
GIVEN le dirigeant soumet code_postal = '1234'
THEN message inline : 'Code postal invalide (5 chiffres requis)'
  AND chantier non créé, autres champs conservés
```

### Scénario 3 — Portefeuille multi-chantiers
```
GIVEN le dirigeant a 5 chantiers actifs
WHEN il ouvre son dashboard
THEN il voit les 5 chantiers : nom, client, pastille colorée, budget écart
  AND chantiers en retard (rouge) en haut de liste
  AND chargement < 1 seconde
```

**DoD** : Validation Zod côté serveur · RLS isolation_org · Tri rouge > orange > vert · Test : admin org A ne voit pas chantiers org B · Perf : 20 chantiers < 1s

**Complexité** : M | **Points** : 5

---

## US-011 — Gérer les tâches d'un chantier

**En tant que** conducteur de travaux (rôle conducteur)
**Je veux** créer, assigner et suivre les tâches d'un chantier
**Afin de** coordonner mes équipes sans passer ma journée au téléphone

### Scénario 1 — Création et assignation
```
GIVEN le conducteur est sur la page d'un chantier actif
WHEN il crée une tâche : titre, assignée à Mohamed, échéance demain, statut a_faire
THEN tâche dans la liste du chantier
  AND notification in-app pour Mohamed
  AND tâche dans la checklist de Mohamed le lendemain
```

### Scénario 2 — Passage en bloqué
```
GIVEN Mohamed est sur sa tâche
WHEN il sélectionne 'Bloqué'
THEN champ 'Raison du blocage' s'affiche (obligatoire, min 10 car.)
WHEN il saisit la raison et valide
THEN tâche en bloqué avec raison enregistrée
  AND notification in-app pour le conducteur
```

### Scénario 3 — Tentative d'accès hors périmètre
```
GIVEN Mohamed tente via l'API de modifier une tâche non assignée
WHEN la requête arrive sur le serveur
THEN HTTP 403 Forbidden
  AND aucune information sur la tâche révélée
```

**DoD** : Validation Zod · Vérification ownership côté serveur · Notifications créées · Test : ouvrier ne peut pas modifier tâche d'un autre → 403 · bloque_raison obligatoire si statut = bloque

**Complexité** : M | **Points** : 5
