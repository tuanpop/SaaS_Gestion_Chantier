# Guide de demo — Claw (ClawBTP)

## Comment ouvrir les prototypes

1. Ouvrez l'**Explorateur de fichiers** de votre ordinateur
2. Allez dans le dossier du prototype que vous voulez presenter :
   - `prototype/` — Version originale
   - `prototype-v2/` — Theme sombre (cockpit)
   - `prototype-v3/` — Theme chaleureux (tons terre)
   - `prototype-v4/` — Theme clair moderne (recommande pour les demos)
3. Double-cliquez sur le fichier **`00-index.html`** — il s'ouvre dans votre navigateur
4. Vous etes sur le hub : cliquez sur n'importe quelle page pour y acceder
5. Le bouton **"← Index"** en haut a gauche de chaque page vous ramene au hub

> **Astuce** : utilisez Chrome ou Edge pour le meilleur rendu. Pas besoin d'internet si les fichiers sont deja charges une premiere fois.

---

## Les 3 profils a presenter

| Profil | Qui c'est | Appareil | Pages |
|---|---|---|---|
| **Admin / Dirigeant** | Le patron, il pilote depuis son bureau | Ordinateur (ecran large) | 14 a 21 |
| **Superviseur** | Le chef d'equipe sur le terrain | Telephone (ecran etroit) | 08 a 13 |
| **Operateur** | L'ouvrier / technicien sur le terrain | Telephone (ecran etroit) | 01 a 07 |

---

## Scenario de demo recommande (15-20 min)

### Acte 1 — Le dirigeant au bureau (5 min)

**Ouvrez les pages Admin depuis l'index (section "Admin")**

| Etape | Page | Ce que vous montrez | Ce que vous dites |
|---|---|---|---|
| 1 | **14 — Login** | L'ecran de connexion | *"Le dirigeant se connecte a son espace. 14 jours d'essai gratuit, sans carte bancaire."* |
| 2 | **15 — Dashboard** | Les KPI, les alertes en rouge/orange, la grille des projets | *"En un coup d'oeil, il voit ses 4 projets, les alertes critiques, et les indicateurs cles. Le rouge saute aux yeux : Les Oliviers est en retard."* |
| 3 | **16 — Detail projet** | Les onglets Taches/Photos/CR, le budget | *"Il plonge dans le projet problematique. Il voit les taches bloquees, le depassement budget de 12%, les photos terrain."* |
| 4 | **20 — ClawBot** | La conversation avec l'IA | *"Il demande a l'assistant IA un resume des blocages. L'IA lui repond avec une synthese structuree, prete a partager."* |

### Acte 2 — Le superviseur sur le terrain (5 min)

**Revenez a l'index, ouvrez les pages Superviseur**

> **Astuce visuelle** : reduisez la fenetre du navigateur en largeur (~400px) pour simuler un telephone.

| Etape | Page | Ce que vous montrez | Ce que vous dites |
|---|---|---|---|
| 5 | **08 — Mes projets** | La liste triee par priorite, les barres de couleur | *"Le superviseur voit ses projets tries par urgence. Rouge en haut, vert en bas. Il sait immediatement ou aller."* |
| 6 | **10 — Taches** | Les taches groupees par projet, les filtres | *"Il gere toutes les taches de ses projets. Il peut filtrer par statut : bloque, en cours, a faire."* |
| 7 | **11 — Comptes-rendus** | Le CR genere par l'IA, les boutons Modifier/Valider | *"Chaque soir a 18h, l'IA genere automatiquement le compte-rendu de la journee. Le superviseur relit, ajuste si besoin, et valide en un clic. Fini les CR ecrits a la main le soir."* |
| 8 | **12 — Alertes** | Les notifications groupees | *"Il recoit les alertes en temps reel : blocages, depassements budget, meteo. Tout est classe par priorite."* |

### Acte 3 — L'operateur sur le terrain (5 min)

**Revenez a l'index, ouvrez les pages Operateur**

> **Rappel** : gardez la fenetre etroite (~375px) pour l'effet telephone.

| Etape | Page | Ce que vous montrez | Ce que vous dites |
|---|---|---|---|
| 9 | **01 — Scan QR** | L'animation du scan | *"L'ouvrier arrive le matin. Il scanne son QR code personnel — pas de mot de passe, pas d'email. En 3 secondes il est connecte."* |
| 10 | **03 — Taches** | La liste des 4 taches avec couleurs | *"Il voit ses taches du jour. Vert = fait, bleu = en cours, rouge = bloque. C'est simple, c'est gros, ca marche avec des gants."* |
| 11 | **04 — Detail tache** | La description, les photos, les boutons d'action | *"Il ouvre une tache, voit ce qu'il doit faire, et peut signaler un blocage ou marquer comme termine. 2 taps maximum pour toute action."* |
| 12 | **05 — Photo** | Les boutons Camera/Galerie, le selecteur de type | *"Il prend une photo d'avancement directement depuis l'appli. La photo est taguee automatiquement sur le bon projet et la bonne tache."* |

### Conclusion (2 min)

| Etape | Page | Ce que vous dites |
|---|---|---|
| 13 | **21 — Plans et tarifs** | *"3 formules, a partir de 49€/mois. Le plan Pro a 99€ inclut l'IA. Sans engagement, 14 jours d'essai gratuit."* |

---

## Les phrases cles a placer pendant la demo

- **"L'outil que vos equipes utilisent vraiment"** — les ouvriers n'ont besoin que de leur QR code
- **"L'IA fait le travail administratif"** — CR automatiques, detection de derives, alertes intelligentes
- **"2 taps maximum"** — toute action critique ouvrier en 2 touches
- **"Pas de formation necessaire"** — QR code, gros boutons, interface epuree
- **"Vos donnees restent en France"** — hebergement souverain

---

## Questions frequentes en demo

| Question | Reponse |
|---|---|
| *"Ca marche hors connexion ?"* | Oui, les taches et photos sont enregistrees localement et synchronisees des que le reseau revient (page 06). |
| *"Il faut un telephone special ?"* | Non, n'importe quel smartphone avec un navigateur. C'est une appli web, pas besoin de telecharger sur l'App Store. |
| *"L'IA peut se tromper ?"* | Les CR generes par l'IA restent en brouillon. Le superviseur relit et valide avant envoi. Rien ne part sans validation humaine. |
| *"C'est juste pour le BTP ?"* | Non, ca fonctionne pour tout metier avec des equipes terrain : maintenance, nettoyage, evenementiel, espaces verts... |
| *"Combien de temps pour deployer ?"* | Inscription en 2 minutes, ajout des equipes en une journee, operationnel des le lendemain. |

---

## Aide-memoire des pages

```
00  Index (hub de navigation)

OPERATEUR (telephone)
01  Scan QR .............. Connexion par QR code
02  Choix du projet ...... Si affecte a plusieurs projets
03  Liste des taches ..... Ecran principal
04  Detail tache ......... Description + photos + actions
05  Prise de photo ....... Camera / galerie + commentaire
06  Etats speciaux ....... Hors ligne, liste vide, sync
07  ClawBot .............. Assistant IA simplifie

SUPERVISEUR (telephone)
08  Mes projets .......... Liste triee par priorite
09  Detail projet ........ Taches + equipe + photos
10  Gestion taches ....... Vue multi-projets + filtres
11  Comptes-rendus ....... CR auto IA + validation
12  Alertes .............. Notifications temps reel
13  ClawBot .............. Assistant IA superviseur

ADMIN (ordinateur)
14  Connexion ............ Login / inscription
15  Dashboard ............ KPIs + alertes + portefeuille
16  Detail projet ........ Budget + taches + photos + CR
17  Nouveau projet ....... Formulaire de creation
18  Equipe ............... Membres + invitations + QR
19  Notifications ........ Centre de notifications
20  ClawBot .............. Assistant IA + rapports
21  Plans et tarifs ...... 3 formules (49/99/179€)
```
