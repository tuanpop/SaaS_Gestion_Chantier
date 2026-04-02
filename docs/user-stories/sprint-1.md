# Sprint 1 — Fondations

## US-001 — Créer un compte et démarrer l'essai gratuit

**En tant que** dirigeant-gérant d'une PME BTP second oeuvre
**Je veux** créer mon compte entreprise et démarrer l'essai gratuit 14 jours sans CB
**Afin de** évaluer le produit sans risque financier

### Scénario 1 — Nominal
```
GIVEN un dirigeant arrive sur la page d'inscription
WHEN il saisit : email pro, mot de passe (min 12 car.), nom entreprise, secteur
  AND il valide
THEN un compte organisation est créé avec trial_ends_at = now() + 14 jours
  AND un email de confirmation est envoyé (Resend)
  AND il est redirigé vers l'onboarding (création 1er chantier guidée)
  AND aucune CB n'est demandée
```

### Scénario 2 — Email déjà utilisé
```
GIVEN un email déjà associé à un compte
WHEN le dirigeant tente de s'inscrire
THEN message générique : "Un problème est survenu. Vérifiez vos informations."
  AND aucune information sur l'existence du compte n'est révélée
```

### Scénario 3 — Trial expiré
```
GIVEN trial_ends_at est dépassé
WHEN le dirigeant se connecte
THEN il voit un écran 'Votre essai gratuit est terminé' avec les 3 plans
  AND il peut consulter ses données en lecture seule [voir PO-001]
  AND toutes les actions d'écriture sont bloquées
```

**DoD** : Scénarios 1-3 en Playwright · RLS sur organisations · JWT claims via Auth Hook · trial_ends_at +14j UTC · Rate limiting signup 10/h/IP

**Complexité** : S | **Points** : 3

---

## US-002 — Connexion sécurisée

**En tant que** utilisateur authentifié (admin ou conducteur)
**Je veux** me connecter avec mon email et mot de passe ou un magic link
**Afin de** accéder à mes données de chantier

### Scénario 1 — Email + Password
```
GIVEN un admin ou conducteur avec un compte actif
WHEN il saisit email + mot de passe corrects
THEN JWT émis : { sub, email, organisation_id, role, exp }
  AND redirection vers son dashboard selon son rôle
```

### Scénario 2 — Magic Link
```
GIVEN un conducteur préfère ne pas gérer un mot de passe
WHEN il saisit son email et clique 'Recevoir un lien'
THEN email avec OTP valable 15 minutes envoyé
WHEN il clique le lien
THEN connecté et redirigé vers son dashboard
```

### Scénario 3 — 5 tentatives échouées
```
GIVEN 5 tentatives de connexion échouées depuis la même IP en 15 min
WHEN une 6ème tentative est faite
THEN blocage 15 minutes + message générique (pas d'info sur la validité de l'email)
```

**DoD** : JWT avec organisation_id + role · Magic Link fonctionnel · Rate limiting 5 req/15 min/IP · Message générique sur erreur

**Complexité** : S | **Points** : 2

---

## US-003 — Inviter des collaborateurs

**En tant que** dirigeant-gérant (rôle admin)
**Je veux** inviter mes conducteurs par email et créer les fiches de mes ouvriers sans email requis
**Afin de** que chaque collaborateur accède uniquement à ce qui le concerne

### Scénario 1 — Invitation conducteur (avec email)
```
GIVEN l'admin est sur la page 'Équipe > Ajouter'
WHEN il saisit prénom, nom, email, rôle = conducteur
THEN Supabase Auth invite_user_by_email() appelé
  AND fiche users créée avec invitation_status = 'pending'
  AND email magic link valable 48h envoyé
  AND le conducteur n'a pas accès jusqu'à activation
```

### Scénario 2 — Création ouvrier (sans email)
```
GIVEN l'admin saisit prénom, nom, téléphone, rôle = ouvrier, email vide
WHEN il valide
THEN fiche users créée sans compte Supabase Auth (has_supabase_auth = false)
  AND qr_token UUID v4 généré et chiffré AES-256-GCM
  AND QR code disponible à l'impression depuis l'interface
  AND aucun email envoyé
```

### Scénario 3 — Invitation expirée (> 48h)
```
GIVEN le lien d'invitation a plus de 48h
WHEN le conducteur clique le lien
THEN message : 'Ce lien a expiré. Demandez à votre responsable de renvoyer l'invitation.'
  AND l'admin peut renvoyer depuis la fiche collaborateur
```

**DoD** : QR token généré côté serveur uniquement · AES-256-GCM · QR imprimable depuis l'UI · Test : ouvrier créé sans email → pas de compte Supabase Auth

**Complexité** : M | **Points** : 5
