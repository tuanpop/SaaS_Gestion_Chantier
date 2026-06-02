'use client'

// components/TrialExpiredBanner.tsx — migré Alert shadcn (étape 7)
//
// Comportement (D-012) :
//   - statut='trial_expired' : Alert variant destructive, non-closable
//   - trial_ends_at dans <3j && statut != 'trial_expired' : Alert variant warning, closable
//   - sinon : rien affiché
//
// role="alert" préservé (RG-MIGR-003)
// IMPORTANT : Ce composant est cosmétique — le blocage réel est côté API (HTTP 402).

import { useState, useMemo } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface TrialExpiredBannerProps {
  trialEndsAt: string
  statut: 'trial_active' | 'trial_expired' | 'active' | 'suspended'
}

function daysUntil(isoDate: string): number {
  const end = new Date(isoDate)
  const now = new Date()
  const diffMs = end.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

export function TrialExpiredBanner({ trialEndsAt, statut }: TrialExpiredBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const daysLeft = useMemo(() => daysUntil(trialEndsAt), [trialEndsAt])

  // Cas 1 : trial_expired — Alert destructive, non-closable
  if (statut === 'trial_expired') {
    return (
      // role="alert" préservé (RG-MIGR-003)
      <Alert variant="destructive" className="w-full rounded-none border-x-0 border-t-0 flex items-center justify-between">
        <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
          <span className="text-sm font-semibold leading-snug">
            Votre essai gratuit a expiré. Passez à un plan payant pour continuer à créer et modifier vos données.
          </span>
          <Button asChild variant="destructive" size="sm" className="shrink-0">
            <a href="/plans">Choisir un plan</a>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  // Cas 2 : trial_ends_at dans <3j — Alert warning, closable
  if (daysLeft <= 3 && statut === 'trial_active' && !dismissed) {
    const daysLabel =
      daysLeft === 0
        ? "Votre essai gratuit expire aujourd'hui."
        : daysLeft === 1
          ? 'Votre essai gratuit expire demain.'
          : `Votre essai gratuit expire dans ${daysLeft} jours.`

    return (
      // role="alert" préservé (RG-MIGR-003)
      <Alert variant="warning" className="w-full rounded-none border-x-0 border-t-0 flex items-center justify-between">
        <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
          <p className="text-sm font-semibold leading-snug">
            {daysLabel}{' '}
            <a
              href="/plans"
              className="underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-[#833C00] focus:ring-offset-1 rounded"
            >
              Choisir un plan maintenant
            </a>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setDismissed(true)}
            aria-label="Fermer ce bandeau d'avertissement"
            className="shrink-0 border-transparent self-start sm:self-auto"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return null
}

export default TrialExpiredBanner
