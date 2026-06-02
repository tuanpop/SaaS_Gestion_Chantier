'use client'

// components/RemoveAffectationButton.tsx
// Bouton "Retirer" pour une affectation — migré ConfirmDialog (étape 6, D-2.5-017)
//
// D-2.5-017 — window.confirm remplacé par <ConfirmDialog> variant destructive
// RG-MIGR-006 — 4 window.confirm → ConfirmDialog
// W006 Itachi — data-testid="remove-affectation-trigger" sur le bouton déclencheur
// K2.5-T-09 — onConfirm dans onClick AlertDialogAction (via ConfirmDialog)

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/lib/hooks/use-toast'

interface RemoveAffectationButtonProps {
  affectationId: string
  memberName: string
  variant?: 'compact' | 'default'
}

export function RemoveAffectationButton({
  affectationId,
  memberName,
  variant = 'default',
}: RemoveAffectationButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { toast } = useToast()

  async function handleConfirm() {
    startTransition(async () => {
      const res = await fetch(`/api/affectations/${affectationId}`, {
        method: 'DELETE',
      })
      if (res.status === 204 || res.ok) {
        router.refresh()
        // K2.5-T-08 : description = JSX
        toast({
          variant: 'success',
          title: 'Membre retiré',
          description: <span>{memberName} a été retiré du chantier.</span>,
        })
      } else {
        const body = (await res.json().catch(() => ({ error: null }))) as { error?: string }
        // K2.5-T-08 : description = JSX
        toast({
          variant: 'destructive',
          title: 'Erreur',
          description: <span>{body.error ?? 'Le retrait a échoué. Réessayez plus tard.'}</span>,
        })
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        data-testid="remove-affectation-button"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        variant="destructive"
        size={variant === 'compact' ? 'sm' : 'default'}
        aria-label={`Retirer ${memberName} du chantier`}
      >
        {pending ? '…' : 'Retirer'}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Retirer ce membre ?"
        description={`Cette action retire ${memberName} de ce chantier.`}
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        variant="destructive"
        onConfirm={handleConfirm}
      />
    </>
  )
}
