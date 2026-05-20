'use client'

// components/RemoveAffectationButton.tsx
// Bouton "Retirer" pour une affectation existante.
//
// Sprint 2 dette (2026-05-20) : la liste des membres affectés à un chantier
// n'avait pas d'action de retrait — l'API DELETE /api/affectations/[id] existait
// (Sprint 2 spec) mais aucune UI ne l'exposait, ni côté admin ni côté conducteur.
//
// Pattern miroir d'ArchiveButton/UnarchiveButton : window.confirm + useTransition
// + router.refresh sur succès.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface RemoveAffectationButtonProps {
  affectationId: string
  memberName: string // pour le confirm + aria-label
  variant?: 'compact' | 'default'
}

export function RemoveAffectationButton({
  affectationId,
  memberName,
  variant = 'default',
}: RemoveAffectationButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (!window.confirm(`Retirer ${memberName} de ce chantier ?`)) {
      return
    }
    startTransition(async () => {
      const res = await fetch(`/api/affectations/${affectationId}`, {
        method: 'DELETE',
      })
      if (res.status === 204 || res.ok) {
        router.refresh()
      } else {
        const body = (await res.json().catch(() => ({ error: null }))) as {
          error?: string
        }
        window.alert(body.error ?? 'Le retrait a échoué. Réessayez plus tard.')
      }
    })
  }

  const sizeClass = variant === 'compact' ? 'text-xs px-2 py-1' : 'text-sm px-3 py-1.5'

  return (
    <button
      type="button"
      data-testid="remove-affectation-button"
      onClick={handleClick}
      disabled={pending}
      aria-label={`Retirer ${memberName} du chantier`}
      className={`btn-brutal bg-white text-danger border-danger ${sizeClass} disabled:opacity-50`}
    >
      {pending ? '…' : 'Retirer'}
    </button>
  )
}
