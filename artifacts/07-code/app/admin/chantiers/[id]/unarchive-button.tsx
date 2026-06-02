'use client'

// app/admin/chantiers/[id]/unarchive-button.tsx
// Migré étape 6 : window.confirm → ConfirmDialog variant default (pas destructive)
//                  window.alert → toast
// D-2.5-017 — RG-MIGR-006
// K2.5-T-09 — onConfirm dans onClick (via ConfirmDialog)

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/lib/hooks/use-toast'

interface UnarchiveButtonProps {
  chantierId: string
}

export function UnarchiveButton({ chantierId }: UnarchiveButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { toast } = useToast()

  async function handleConfirm() {
    startTransition(async () => {
      const res = await fetch(`/api/chantiers/${chantierId}/unarchive`, { method: 'POST' })
      if (res.ok) {
        router.refresh()
        // K2.5-T-08 : description = JSX
        toast({
          variant: 'success',
          title: 'Chantier désarchivé',
          description: <span>Le chantier est de nouveau actif.</span>,
        })
      } else {
        const body = await res.json().catch(() => ({ error: null })) as { error?: string }
        // K2.5-T-08 : description = JSX
        toast({
          variant: 'destructive',
          title: 'Erreur',
          description: <span>{body.error ?? 'Le désarchivage a échoué. Réessayez plus tard.'}</span>,
        })
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        data-testid="unarchive-button"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        variant="default"
        size="sm"
      >
        {pending ? 'Désarchivage…' : 'Désarchiver'}
      </Button>

      {/* variant="default" — action positive, pas destructive */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Désarchiver ce chantier ?"
        description="Il redeviendra actif et apparaîtra dans la liste des chantiers en cours."
        confirmLabel="Désarchiver"
        cancelLabel="Annuler"
        variant="default"
        onConfirm={handleConfirm}
      />
    </>
  )
}
