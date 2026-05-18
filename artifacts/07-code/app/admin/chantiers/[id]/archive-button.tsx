'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface ArchiveButtonProps {
  chantierId: string
}

export function ArchiveButton({ chantierId }: ArchiveButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (!window.confirm('Archiver ce chantier ? Les données seront conservées.')) {
      return
    }
    startTransition(async () => {
      const res = await fetch(`/api/chantiers/${chantierId}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/admin/chantiers')
        router.refresh()
      } else {
        window.alert("L'archivage a échoué. Réessayez plus tard.")
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="btn-brutal bg-white text-danger text-sm py-2 px-4 disabled:opacity-50"
    >
      {pending ? 'Archivage…' : 'Archiver'}
    </button>
  )
}
