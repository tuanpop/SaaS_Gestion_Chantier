'use client'
// components/ouvrier/ConfirmDeletePhotoDialog.tsx
// Dialog confirmation suppression photo — ouvrier ET conducteur (isConducteur prop)
// Maquettes : 02-galerie-modale-sprint-4.html + 03-moderation-photo-conducteur-sprint-4.html
//
// K4-LOW-06 : message "Cette action est irréversible." (D-4-009 — hard delete)
// K4-HI-06 : referrerpolicy="no-referrer" sur la miniature
// role="alertdialog" : accessibilite, annonce le contenu urgent au lecteur ecran

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

interface ConfirmDeletePhotoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
  photoSignedUrl: string
  isLoading: boolean
  /** Si true : affiche un contexte "moderation conducteur" */
  isConducteur?: boolean
}

export function ConfirmDeletePhotoDialog({
  open,
  onOpenChange,
  onConfirm,
  photoSignedUrl,
  isLoading,
  isConducteur = false,
}: ConfirmDeletePhotoDialogProps) {
  // data-testid conditionnel selon le contexte (ouvrier vs conducteur)
  const testIdPrefix = isConducteur ? 'conducteur' : 'ouvrier'

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid={`${testIdPrefix}-confirm-delete-dialog`}
        style={{
          maxWidth: '340px',
          borderRadius: '8px',
          border: '2px solid #000',
          boxShadow: '4px 4px 0 0 #000',
          padding: '20px',
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '16px',
              color: '#163958',
            }}
          >
            Supprimer la photo ?
          </AlertDialogTitle>

          {/* Miniature photo — K4-HI-06 : referrerpolicy="no-referrer" */}
          <div
            style={{
              aspectRatio: '4/3',
              overflow: 'hidden',
              borderRadius: '4px',
              border: '1.5px solid #E5E7EB',
              marginTop: '8px',
              marginBottom: '8px',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoSignedUrl}
              alt="Photo à supprimer"
              referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>

          <AlertDialogDescription
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '13px',
              color: '#4A4A4A',
            }}
          >
            {isConducteur
              ? 'Vous allez supprimer cette photo (modération). '
              : ''}
            {/* K4-LOW-06 : texte confirmation irréversible */}
            Cette action est irréversible.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter style={{ flexDirection: 'column', gap: '8px' }}>
          {/* Bouton Supprimer — destructive, touch ≥ 56px */}
          <AlertDialogAction
            data-testid={`${testIdPrefix}-confirm-delete-btn`}
            onClick={onConfirm}
            disabled={isLoading}
            style={{
              backgroundColor: '#C00000',
              color: '#FFFFFF',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '15px',
              height: '56px',
              width: '100%',
              border: '2px solid #C00000',
              borderRadius: '4px',
              boxShadow: '2px 2px 0 0 #000',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Suppression...' : 'Supprimer'}
          </AlertDialogAction>

          {/* Bouton Annuler — secondary, touch ≥ 56px */}
          <AlertDialogCancel
            data-testid={`${testIdPrefix}-cancel-delete-btn`}
            disabled={isLoading}
            style={{
              backgroundColor: '#F0F4F8',
              color: '#163958',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 600,
              fontSize: '15px',
              height: '56px',
              width: '100%',
              border: '2px solid #163958',
              borderRadius: '4px',
              margin: 0,
            }}
          >
            Annuler
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
