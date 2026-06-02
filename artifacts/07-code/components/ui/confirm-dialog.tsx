'use client'

// components/ui/confirm-dialog.tsx
// Composant projet — wrapper ConfirmDialog basé sur AlertDialog shadcn (D-2.5-017, ADR-2.5-005)
// Remplace les 4 window.confirm (RemoveAffectationButton, archive-button, unarchive-button, EquipeClient)
//
// SECURITY: K2.5-T-09 — onConfirm DANS onClick sur AlertDialogAction, jamais dans useEffect
// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// ADR-2.5-005 : AlertDialog (role="alertdialog") — plus approprié que Dialog pour confirmations

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

// ============================================================
// Types
// ============================================================

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string    // défaut: "Confirmer"
  cancelLabel?: string     // défaut: "Annuler"
  variant?: 'default' | 'destructive'  // défaut: 'default'
  // SECURITY: K2.5-T-09 — onConfirm requiert click DOM, pas d'auto-trigger
  onConfirm: () => void | Promise<void>
}

// ============================================================
// ConfirmDialog
// ============================================================

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          {/* SECURITY: K2.5-T-09 — onConfirm dans onClick uniquement, jamais dans useEffect */}
          <AlertDialogAction
            className={cn(
              variant === 'default' &&
                'bg-primary text-primary-foreground hover:bg-[#163958] border-primary',
              variant === 'destructive' &&
                'bg-destructive text-destructive-foreground hover:bg-[#A00000] border-destructive',
            )}
            onClick={() => {
              // SECURITY: K2.5-T-09 — onConfirm dans onClick du bouton DOM (pas useEffect)
              void onConfirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
