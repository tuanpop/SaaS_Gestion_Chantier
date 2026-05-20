'use client'

// Sprint 2 dette (2026-05-20) — bouton "Désarchiver" sur le détail admin.
// Visible uniquement si chantier.statut === 'archive'.
// POST /api/chantiers/[id]/unarchive (endpoint dédié, admin uniquement).

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface UnarchiveButtonProps {
  chantierId: string
}

export function UnarchiveButton({ chantierId }: UnarchiveButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (!window.confirm('Désarchiver ce chantier ? Il redeviendra actif et apparaîtra dans la liste des chantiers en cours.')) {
      return
    }
    startTransition(async () => {
      const res = await fetch(`/api/chantiers/${chantierId}/unarchive`, { method: 'POST' })
      if (res.ok) {
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({ error: null })) as { error?: string }
        window.alert(body.error ?? 'Le désarchivage a échoué. Réessayez plus tard.')
      }
    })
  }

  return (
    <button
      type="button"
      data-testid="unarchive-button"
      onClick={handleClick}
      disabled={pending}
      className="btn-brutal bg-accent text-white text-sm py-2 px-4 disabled:opacity-50"
    >
      {pending ? 'Désarchivage…' : 'Désarchiver'}
    </button>
  )
}
