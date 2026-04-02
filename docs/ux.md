# UX/UI — Règles pour Claude Code

## Direction visuelle

**Contexte** : outil professionnel BTP, pas une startup tech. L'utilisateur est un dirigeant de 45 ans ou un ouvrier de 30 ans avec les mains sales. Le design doit inspirer **confiance et efficacité**, pas "innovation".

**Ce qui est interdit** :
- Gradients violet/blanc ou bleu/blanc "startup générique"
- Cards Bootstrap-style avec `box-shadow: 0 4px 6px rgba(0,0,0,0.1)`
- Boutons CTA arrondis génériques avec `border-radius: 999px`
- Polices Inter ou Roboto comme choix créatif principal
- Animations décoratives — uniquement des animations fonctionnelles (feedback, transition d'état)

**Ce qui est attendu** :
- Hiérarchie visuelle forte — l'utilisateur sait toujours où regarder
- Couleurs sémantiques cohérentes : rouge = problème, vert = OK, orange = attention
- Feedback immédiat sur chaque action (loading state, confirmation, erreur)
- Densité d'information adaptée au persona — dashboard dirigeant dense, interface ouvrier aérée

---

## Palette de couleurs

Utiliser ces variables CSS dans tous les composants. Ne jamais hardcoder les couleurs.

```css
:root {
  /* Primaires */
  --color-primary: #1F4E79;        /* Bleu BTP — headers, nav, CTA primaires */
  --color-primary-light: #2E75B6;  /* Bleu clair — hover, accents */
  --color-primary-bg: #D6E4F0;     /* Bleu très clair — backgrounds info */

  /* Sémantiques */
  --color-danger: #C00000;         /* Rouge — retard, dépassement, erreur */
  --color-danger-bg: #FFCCCC;
  --color-warning: #833C00;        /* Orange — attention, jalons proches */
  --color-warning-bg: #FCE4D6;
  --color-success: #1E6B3C;        /* Vert — dans les temps, validé */
  --color-success-bg: #E2EFDA;

  /* Neutres */
  --color-bg: #FFFFFF;
  --color-surface: #F2F2F2;
  --color-border: #CCCCCC;
  --color-text: #222222;
  --color-text-muted: #666666;

  /* Spacing */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  --spacing-2xl: 4rem;
}
```

---

## Règles par persona

### Interface Ouvrier (PWA mobile)

**Principe absolu : 2 taps maximum pour toute action critique.**

```
✅ Tap 1 → sélectionner la tâche
✅ Tap 2 → marquer terminé
❌ Jamais : tap 1 → ouvrir menu → tap 2 → sous-menu → tap 3 → action
```

**Contraintes de layout :**
- Boutons tactiles : **min 56px hauteur** (pas 44px — plus confortable avec les gants)
- Espacement entre éléments cliquables : **min 8px** (évite les taps accidentels)
- Éléments d'action en **bas de l'écran** (zone de confort pouce)
- **Jamais de menus hamburger** — navigation plate uniquement
- Max **5 éléments visibles** sur l'écran principal
- Texte corps : **min 16px** — lisible en plein soleil

**Composants interdits sur l'interface ouvrier :**
- Selects natifs iOS → utiliser `Drawer` shadcn/ui
- Tooltips (inaccessibles sur tactile)
- Hover states (inutiles sur tactile)
- Tableaux de données (trop dense pour mobile)

**Feedback obligatoire :**
- Animation de validation quand une tâche passe en "Terminé" (vert, 300ms)
- Feedback haptique sur les actions critiques (Terminé, Bloqué) si disponible
- Indicateur visuel clair pour les uploads en attente offline
- Banner "Ajouter à l'écran d'accueil" après le premier scan QR réussi

**États à designer impérativement :**
- Tâche à faire / en cours / terminée / bloquée
- Offline (indicateur discret mais visible)
- Upload en attente de sync
- Aucune tâche aujourd'hui
- Aucune affectation active (message + numéro conducteur)
- Sélecteur de chantier (si 2+ affectations actives le même jour)

---

### Interface Conducteur (Web responsive mobile-first)

**Principe : même densité qu'une app native, même fluidité.**

**Navigation mobile :**
- `BottomNavigationBar` fixe — max 5 onglets
- Onglets suggérés : Chantiers / Tâches / CR / Alertes / ClawBot
- Icônes + labels courts (pas d'icônes seules)

**Formulaires et inputs :**
```tsx
// Toujours spécifier le bon type de clavier
<input type="tel" />                    // Budget, téléphone
<input inputMode="numeric" />          // Chiffres avec décimales
<textarea rows={3} />                  // Commentaires — jamais rows={1}
<input enterKeyHint="done" />          // "OK" au lieu de "Entrée" sur iOS
<input autoCorrect="off" spellCheck={false} /> // Désactiver sur les noms de chantiers
```

**Selects → Drawer :**
```tsx
// ❌ Select natif — roue de fortune iOS inutilisable
<select><option>Bloqué</option></select>

// ✅ Drawer shadcn/ui
import { Drawer } from "@/components/ui/drawer"
```

**TanStack Query — config mobile obligatoire :**
```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 min
      refetchOnWindowFocus: false,    // CRITIQUE — pas de refetch à chaque notif
      refetchOnReconnect: true,       // Utile après perte réseau
      retry: 2,
    }
  }
})
```

**États à designer :**
- Liste chantiers vide (premier usage)
- Chantier avec 0 tâches
- CR en attente de validation (badge + notification)
- Alerte dérive active sur un chantier
- ClawBot en train de répondre (streaming)

---

### Interface Admin / Dashboard Dirigeant

**Principe : comprendre l'état global en 30 secondes.**

**Vue portefeuille — règles de coloration strictes :**
```
Rouge  → date_fin_prevue dépassée OU budget_depense > 100%
Orange → date_fin_prevue dans ≤ 3 jours OU dérive détectée
Vert   → tout est dans les temps
```

**Tri obligatoire :** Rouge en haut → Orange → Vert

**Dashboard — hiérarchie d'information :**
1. Alertes actives (si existantes) — visibles immédiatement sans scroll
2. Chantiers en retard / en dérive
3. Chantiers dans les temps
4. Métriques globales (en bas ou sidebar)

**Composants dense desktop :**
- Tables de données avec tri et filtres
- Graphiques simples (budget consommé vs alloué)
- Notifications dans un panel latéral ou drawer

---

## Composants shadcn/ui — guide d'utilisation

| Cas d'usage | Composant recommandé |
|---|---|
| Actions mobiles (statut, priorité) | `Drawer` |
| Confirmation avant action critique | `AlertDialog` |
| Notifications / alertes inline | `Alert` |
| Navigation mobile | `Tabs` en bottom bar |
| Formulaires longs | `Sheet` (slide depuis le bas) |
| Actions rapides sur un item | `DropdownMenu` ou swipe action custom |
| Feedback succès/erreur | `Toast` (sonner) |
| Chargement données | `Skeleton` — jamais de spinner centré seul |

---

## Règles d'accessibilité minimales

- Contraste texte/fond : **ratio ≥ 4.5:1** corps, **≥ 3:1** grands titres
- Focus visible sur tous les éléments interactifs
- `aria-label` sur les icônes sans texte
- Structure sémantique : `<header>`, `<main>`, `<nav>`, `<footer>`
- `<button>` pour les actions — jamais `<div onClick>`
- `prefers-reduced-motion` respecté sur toutes les animations

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## PWA — règles techniques UI

```json
// public/manifest.json — obligatoire
{
  "name": "ClawBTP",
  "short_name": "ClawBTP",
  "start_url": "/mobile/taches",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#1F4E79",
  "theme_color": "#1F4E79"
}
```

**Détection in-app browser obligatoire :**
```tsx
// Si ouvert depuis WhatsApp ou email → afficher banner Safari
const isInAppBrowser = /FBAN|FBAV|Instagram|Twitter/i.test(navigator.userAgent)
if (isInAppBrowser) {
  // Banner : "Ouvre ce lien dans Safari pour la meilleure expérience"
}
```

**Clavier iOS — gestion obligatoire :**
```tsx
// Éviter le décalage viewport quand le clavier s'ouvre
import { Keyboard } from '@capacitor/keyboard' // si Capacitor activé
// ou CSS :
// body { height: 100dvh } // dvh = dynamic viewport height
```

---

## ClawBot — règles UI spécifiques

- Interface chat distincte pour chaque rôle (pas le même prompt system visible)
- **Streaming obligatoire** — afficher les tokens au fur et à mesure (SSE)
- **Boutons [Confirmer] [Annuler]** pour toute action d'écriture — jamais d'exécution directe
- Indicateur "ClawBot réfléchit..." pendant la génération
- Onboarding ouvrier : ClawBot s'affiche automatiquement au premier scan du jour
- Interface ouvrier : chat simplifié, pas de markdown rendu — texte brut uniquement
