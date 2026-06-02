'use client'

// app/admin/chantiers/[id]/archive-button.tsx
// Migré étape 6 : window.confirm → ConfirmDialog variant destructive
//                  window.alert → toast
// D-2.5-017 — RG-MIGR-006
// K2.5-T-09 — onConfirm dans onClick (via ConfirmDialog)

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/lib/hooks/use-toast'

interface ArchiveButtonProps {
  chantierId: string
}

export function ArchiveButton({ chantierId }: ArchiveButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { toast } = useToast()

  async function handleConfirm() {
    startTransition(async () => {
      const res = await fetch(`/api/chantiers/${chantierId}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/admin/chantiers')
        router.refresh()
      } else {
        // K2.5-T-08 : description = JSX
        toast({
          variant: 'destructive',
          title: 'Erreur',
          description: <span>L&apos;archivage a échoué. Réessayez plus tard.</span>,
        })
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        variant="destructive"
        size="sm"
      >
        {pending ? 'Archivage…' : 'Archiver'}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Archiver ce chantier ?"
        description="Les données seront conservées. Cette action peut être annulée depuis la page du chantier."
        confirmLabel="Archiver"
        cancelLabel="Annuler"
        variant="destructive"
        onConfirm={handleConfirm}
      />
    </>
  )
}
