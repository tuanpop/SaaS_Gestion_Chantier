'use client'

// ============================================================
// TrialExpiredBanner — Bandeau persistant état trial
//
// Comportement (D-012, SPRINT_1_PLAN.md §6.1) :
//   - statut='trial_expired' : bandeau ROUGE non-closable
//   - trial_ends_at dans <3j && statut != 'trial_expired' : bandeau ORANGE closable (session)
//   - sinon : rien affiché
//
// IMPORTANT : Ce composant est cosmétique — le blocage réel est côté API (HTTP 402).
// Décision humaine : UI indique l'état, mais la garde de sécurité est dans assertTrialActive().
//
// Couleurs : CSS vars --color-danger / --color-warning (globals.css §Palette ClawBTP)
// Police : Public Sans héritée du body (globals.css) — corrigée Sprint 2 (T21)
// ============================================================

import { useState, useMemo } from 'react'

// ============================================================
// Props
// ============================================================

interface TrialExpiredBannerProps {
  /** ISO 8601 — date de fin d'essai */
  trialEndsAt: string
  /** Statut courant de l'organisation */
  statut: 'trial_active' | 'trial_expired' | 'active' | 'suspended'
}

// ============================================================
// Helpers
// ============================================================

/**
 * Calcule le nombre de jours restants avant la fin d'essai.
 * Retourne un entier positif ou 0 si la date est dépassée.
 */
function daysUntil(isoDate: string): number {
  const end = new Date(isoDate)
  const now = new Date()
  const diffMs = end.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

// ============================================================
// Composant
// ============================================================

export function TrialExpiredBanner({ trialEndsAt, statut }: TrialExpiredBannerProps) {
  // Contrôle de fermeture — uniquement pour le bandeau warning (closable pour la session)
  const [dismissed, setDismissed] = useState(false)

  const daysLeft = useMemo(() => daysUntil(trialEndsAt), [trialEndsAt])

  // --- Cas 1 : trial_expired -> bandeau rouge non-closable ---
  if (statut === 'trial_expired') {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="trial-banner-danger w-full px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
      >
        <p className="text-sm font-semibold leading-snug">
          Votre essai gratuit a expiré. Passez à un plan payant pour continuer à créer et
          modifier vos données.
        </p>
        {/* T17 — btn-brutal remplace rounded-md hover:opacity-90 (non conforme design system neubrutalism) */}
        <a
          href="/plans"
          className="btn-brutal shrink-0 bg-danger text-white text-sm focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2"
        >
          Choisir un plan
        </a>
      </div>
    )
  }

  // --- Cas 2 : trial_ends_at dans <3j -> bandeau orange closable ---
  if (daysLeft <= 3 && statut === 'trial_active' && !dismissed) {
    const daysLabel =
      daysLeft === 0
        ? "Votre essai gratuit expire aujourd'hui."
        : daysLeft === 1
          ? 'Votre essai gratuit expire demain.'
          : `Votre essai gratuit expire dans ${daysLeft} jours.`

    return (
      <div
        role="alert"
        aria-live="polite"
        className="trial-banner-warning w-full px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
      >
        <p className="text-sm font-semibold leading-snug">
          {daysLabel}{' '}
          <a
            href="/plans"
            className="underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-[var(--color-warning)] focus:ring-offset-1 rounded"
          >
            Choisir un plan maintenant
          </a>
        </p>
        {/* Bouton fermeture — closable pour la session uniquement (dismiss en mémoire React) */}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Fermer ce bandeau d'avertissement"
          className="shrink-0 text-[var(--color-warning)] hover:opacity-70 transition-opacity duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--color-warning)] focus:ring-offset-1 rounded p-1 self-start sm:self-auto"
        >
          {/* Croix SVG — pas de lucide-react pour garder le composant léger */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    )
  }

  // --- Cas 3 : rien à afficher ---
  return null
}

export default TrialExpiredBanner
