// tailwind.config.ts — ClawBTP Sprint 2
// Design system Hana (2026-05-15) : Outfit + Public Sans + orange #F97316 + cream #FAFAF8 + neubrutalism BTP
// Corrige dette Sprint 1 : Plus Jakarta Sans → Outfit/Public Sans (DECISIONLOG 2026-05-15)
// Source : artifacts/04-ux/ux-design-system.md §2 Typographie + §3 Palette
// Référence prototypes : mockups/00-index.html lignes 11-27

import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        // Hana spec : Outfit = headings, labels, boutons, KPI | Public Sans = corps, inputs, descriptions
        heading: ['Outfit', 'sans-serif'],
        sans: ['Public Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Palette exacte extraite des 24 prototypes (ux-design-system.md §3)
        primary: {
          DEFAULT: '#1F4E79',   // Bleu BTP — headers, nav, CTA secondaires
          light: '#2E75B6',     // Hover states, accents liens
          dark: '#163958',      // Sidebar admin, header ouvrier
          bg: '#D6E4F0',        // Background info, avatar conducteur
        },
        accent: '#F97316',      // Orange sécurité — CTA primaire, bot, active nav, highlight
        danger: {
          DEFAULT: '#C00000',   // Rouge — retard, dépassement, erreur, alerte
          bg: '#FFCCCC',        // Background badge/alerte danger
        },
        warning: {
          DEFAULT: '#833C00',   // Ambre — dérive budget, jalons proches
          bg: '#FCE4D6',        // Background badge warning
        },
        success: {
          DEFAULT: '#1E6B3C',   // Vert — tâches OK, dans les temps, validé
          bg: '#E2EFDA',        // Background badge success
        },
        surface: '#F2F2F2',     // Fond sous-éléments, progress bar track
        cream: '#FAFAF8',       // Fond global (jamais blanc pur)
        // Aligné sur proto : `text-muted` = #555555 (texte secondaire lisible).
        // Pour fond gris clair, utiliser `bg-surface` (#F2F2F2) — pas `bg-muted`.
        muted: '#555555',
        // shadcn/ui compatibility tokens
        background: '#FAFAF8',      // cream
        foreground: '#222222',
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#222222',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#222222',
        },
        secondary: {
          DEFAULT: '#F2F2F2',   // surface
          foreground: '#222222',
        },
        destructive: {
          DEFAULT: '#C00000',
          foreground: '#ffffff',
        },
        border: '#000000',          // Bordures brutalist 2px solid #000
        input: '#000000',
        ring: '#F97316',            // Ring orange accent au focus
      },
      borderRadius: {
        // Spec Hana : 6px MAXIMUM — jamais 8px, jamais rounded-full sur les boutons
        DEFAULT: '6px',
        lg: '6px',    // shadcn/ui "lg" -> 6px
        md: '6px',    // shadcn/ui "md" -> 6px
        sm: '4px',    // badges uniquement (§4.4)
        full: '9999px', // Gardé uniquement pour les pastilles de statut (rond 12px)
      },
      minHeight: {
        touch: '56px', // WCAG + gants BTP
      },
      minWidth: {
        touch: '56px',
      },
      keyframes: {
        // Animation dot pulse (état loading) — ux-design-system.md §4.17
        'dot-pulse': {
          '0%, 80%, 100%': { opacity: '0.3', transform: 'scale(0.8)' },
          '40%': { opacity: '1', transform: 'scale(1)' },
        },
        // Animation task-done validation ouvrier
        'task-done': {
          '0%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: '#E2EFDA' },
          '100%': { backgroundColor: '#E2EFDA' },
        },
      },
      animation: {
        'dot-pulse': 'dot-pulse 1.4s infinite',
        'task-done': 'task-done 300ms ease-in-out forwards',
      },
      boxShadow: {
        // Neubrutalism — hard offset shadows, zéro blur
        brutal: '4px 4px 0 #000',
        'brutal-sm': '3px 3px 0 #000',
        'brutal-mobile': '3px 3px 0 #000',
        'brutal-hover': '6px 6px 0 #000',
        'brutal-active': '2px 2px 0 #000',
        'brutal-pressed': '0 0 0 #000',
        'brutal-danger': '3px 3px 0 #C00000',
        'brutal-success': '3px 3px 0 #1E6B3C',
        'brutal-accent': '3px 3px 0 #F97316',
      },
    },
  },
  plugins: [],
}

export default config
