# ClawBTP — Templates emails

Tous les templates HTML des emails envoyes par ClawBTP, centralises en miroir de la structure AdTomate.

## Structure

```
templates/emails/
├── _layout.html                # Shell partage : header logo, carte, footer
│                               # Variables : {{TITLE}} {{PREHEADER}} {{BODY}}
├── app/                        # Body fragments — charges runtime par l'app
│   └── welcome.html            # {{ORG_NAME}} {{APP_URL}}
└── supabase/                   # Templates a coller dans Supabase Auth Dashboard
    ├── confirm-signup.html     # {{ .Token }} (code OTP 6 chiffres)
    ├── magic-link.html         # {{ .Token }} (code OTP 6 chiffres)
    ├── invite-user.html        # {{ .ConfirmationURL }}
    ├── reset-password.html     # {{ .ConfirmationURL }}
    └── change-email.html       # {{ .ConfirmationURL }}
```

## Emails app/ (runtime)

Ces fichiers sont **charges depuis le disque** par [lib/notifications/email-layout.ts](../../lib/notifications/email-layout.ts) (`fs.readFileSync` + cache Map) puis injectes dans `_layout.html` et envoyes via Resend.

**Pour modifier le texte ou le visuel d'un email** : editez directement le fichier HTML correspondant. Aucune modification de code TS necessaire (sauf pour ajouter une nouvelle variable `{{...}}`).

**Substitution** : `{{KEY}}` est remplace par la valeur passee dans le parametre `vars` du `renderEmail()`. Les valeurs user (email, nom d'organisation...) sont **escape-HTMLisees** par `escapeHtml()` dans le code TS avant substitution.

**Build standalone** : le dossier `templates/` est inclus dans le build via `outputFileTracingIncludes` dans [next.config.js](../../next.config.js) (pattern `/api/**/*` -> `./templates/**/*`).

### Ajouter un nouvel email app/

1. Creer `templates/emails/app/mon-email.html` (body fragment uniquement, pas de `<html>`)
2. Appeler `renderEmail({ bodyTemplate: 'mon-email', title: '...', preheader: '...', vars: {...} })`
3. Envoyer avec `sendEmail({ to, subject, html, tag })`

## Emails supabase/ (a coller manuellement)

Ces emails sont envoyes par **Supabase Auth** (pas par l'app), donc pas generes par notre code.
Pour les appliquer :

1. Aller sur **Supabase Dashboard -> Authentication -> Email Templates**
2. Pour chaque template ci-dessous, copier le contenu du fichier `.html` et le coller dans le champ correspondant
3. Sauvegarder

| Fichier | Template Supabase | Variables utilisees |
|---|---|---|
| `confirm-signup.html` | Confirm signup | `{{ .Token }}` (code OTP 6 chiffres) |
| `magic-link.html` | Magic Link | `{{ .Token }}` (code OTP 6 chiffres) |
| `invite-user.html` | Invite user | `{{ .ConfirmationURL }}` |
| `reset-password.html` | Reset Password | `{{ .ConfirmationURL }}` |
| `change-email.html` | Change Email Address | `{{ .ConfirmationURL }}` |

> Note syntaxe : les templates Supabase utilisent `{{ .Token }}` et `{{ .ConfirmationURL }}` (avec un POINT),
> different de notre syntaxe app `{{KEY}}` (sans point). Ne pas confondre.

> Configurer aussi le **SMTP custom Resend** dans `Authentication -> SMTP Settings` pour bypasser le rate limit 3/h du free tier Supabase.

## Direction artistique

Strictement alignee sur la charte ClawBTP (cf. `app/globals.css`, `tailwind.config.ts`, design system Hana Sprint 2).

### Couleurs

| Token | Hex | Usage email |
|---|---|---|
| Cream (bg page) | `#FAFAF8` | Fond page (jamais blanc pur) |
| Card | `#FFFFFF` | Carte centrale |
| Border card | `#000000` 2px solid | Bordure brutalist (pas de border-radius en email) |
| Primary-dark (foreground) | `#163958` | Titres H1, logo "BTP", strong |
| Body text | `#222222` | Paragraphes |
| Muted | `#555555` | Footer, helper text |
| Accent (CTA) | `#F97316` | Boutons, "Claw" du logo, barre info-box |
| Accent light (info-box bg) | `#FFF3E8` | Fond info-box (variante claire du orange) |
| Success | `#1E6B3C` | Confirmations (rarement utilise en email) |
| Danger | `#C00000` | Erreurs / messages critiques |

### Typographie

- **Display/headings** : `Outfit` weight **700-800** — chargee via Google Fonts (`<link>`), fallback `Georgia, 'Times New Roman', serif`
- **Body** : `Public Sans` weights 400/500/600 — fallback `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
- Outlook ignore Google Fonts -> tombe sur Georgia + system stack

### Composants

- **Logo** : `Claw` (orange `#F97316`) + `BTP` (bleu `#163958`), Outfit 800, letter-spacing -0.5px — strictement identique au logo app (`app/admin/layout.tsx` SidebarNavClient + `app/(auth)/login/page.tsx`)
- **Carte** : blanc, bordure `#000000` 2px solid (pas de border-radius en email, tombe carre sur Outlook — style brutalist coherent avec le design system)
- **Bouton CTA** : background orange `#F97316`, texte blanc, padding 14x30px, bulletproof table-based (sans border-radius pour compat Outlook)
- **Bloc info** : fond `#FFF3E8`, barre gauche orange `#F97316` 3px — utilise via `buildInfoBox()` dans email-layout.ts
- **Footer** : logo + tagline italique `La gestion de chantier dediee au second oeuvre.` + lien URL app

## Bonnes pratiques email respectees

- **Tables HTML** pour le layout (compat Outlook)
- **Styles inline** sur tous les elements visuels (Gmail strip parfois `<style>`)
- **Bulletproof buttons** : `<td>` + `<a>` colores tous les deux (compat Outlook qui ignore le radius `<a>`)
- **Conditionnels MSO** : `<!--[if mso]>` pour forcer 96 PPI Outlook
- **`color-scheme: light only`** : empeche l'inversion automatique en dark mode (Gmail/Apple Mail)
- **`format-detection: telephone=no`** : iOS n'auto-linkifie plus les numeros (qui deviendraient bleus)
- **`-webkit-text-size-adjust:100%`** : empeche iOS de zoomer le texte
- **`mso-table-lspace:0pt`** : supprime les marges horizontales auto Outlook
- **`mso-hide:all`** sur le preheader (sinon Outlook le rend visible)
- **Preheader masque** (preview client mail Gmail/Apple Mail)
- **Media query mobile** sur `.cb-card`, `.cb-h1`, `.cb-btn`, `.cb-otp` (< 620px)
- **`role="presentation"`** sur toutes les tables layout (a11y)
- **`target="_blank"`** sur tous les liens externes
- **`word-break:break-all`** sur les URLs fallback (evite debordement horizontal)
- **Couleurs HEX** (pas HSL — vieux clients ne supportent pas)
- **Pas d'emoji**, pas de SVG inline (Outlook les casse)
- **Pas de `background-image`** (Outlook ne les rend pas)
- **Pas de webfonts custom** sans fallback web-safe
