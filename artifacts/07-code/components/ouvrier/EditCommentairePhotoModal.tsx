'use client'
// components/ouvrier/EditCommentairePhotoModal.tsx
// Modal édition commentaire photo (maquette 02-galerie-modale-sprint-4.html)
//
// Dialog non-destructif (shadcn Dialog, pas AlertDialog)
// Textarea max 500 chars, font-size 16px (evite le zoom iOS auto)
// Sauvegarde vide -> null (supprime le commentaire)

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

const MAX_COMMENTAIRE = 500

interface EditCommentairePhotoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (commentaire: string | null) => void | Promise<void>
  initialCommentaire: string | null
  isLoading: boolean
  photoSignedUrl: string
}

export function EditCommentairePhotoModal({
  open,
  onOpenChange,
  onSave,
  initialCommentaire,
  isLoading,
  photoSignedUrl,
}: EditCommentairePhotoModalProps) {
  const [commentaire, setCommentaire] = useState(initialCommentaire ?? '')

  // Remettre la valeur initiale quand la modal s'ouvre
  useEffect(() => {
    if (open) {
      setCommentaire(initialCommentaire ?? '')
    }
  }, [open, initialCommentaire])

  function handleSave() {
    // Sauvegarde vide -> null (supprime le commentaire existant)
    const value = commentaire.trim()
    onSave(value === '' ? null : value)
  }

  const remaining = MAX_COMMENTAIRE - commentaire.length
  const isOverLimit = commentaire.length > MAX_COMMENTAIRE

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="ouvrier-edit-comment-dialog"
        style={{
          maxWidth: '340px',
          borderRadius: '8px',
          border: '2px solid #000',
          boxShadow: '4px 4px 0 0 #000',
          padding: '20px',
        }}
      >
        <DialogHeader>
          <DialogTitle
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '16px',
              color: '#163958',
            }}
          >
            Modifier le commentaire
          </DialogTitle>
          <DialogDescription
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '13px',
              color: '#666666',
            }}
          >
            Le commentaire sera visible dans la galerie de la tâche.
          </DialogDescription>
        </DialogHeader>

        {/* Miniature photo — K4-HI-06 : referrerpolicy="no-referrer" */}
        <div
          style={{
            aspectRatio: '4/3',
            overflow: 'hidden',
            borderRadius: '4px',
            border: '1.5px solid #E5E7EB',
            marginBottom: '12px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoSignedUrl}
            alt="Photo"
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>

        {/* Textarea — font-size 16px pour eviter le zoom iOS automatique */}
        <div style={{ marginBottom: '8px' }}>
          <Textarea
            data-testid="ouvrier-edit-comment-textarea"
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            maxLength={MAX_COMMENTAIRE + 10} // souplesse UI, limite serveur = 500
            placeholder="Ajouter un commentaire (optionnel)..."
            rows={3}
            disabled={isLoading}
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '16px', // evite zoom iOS auto
              resize: 'none',
              minHeight: '80px',
              borderColor: isOverLimit ? '#C00000' : undefined,
            }}
          />
          {/* Compteur caractères */}
          <p
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '11px',
              color: isOverLimit ? '#C00000' : '#888888',
              textAlign: 'right',
              marginTop: '4px',
            }}
            aria-live="polite"
          >
            {remaining < 0 ? `${Math.abs(remaining)} caractères en trop` : `${remaining} restants`}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Bouton Enregistrer — primary-dark, touch ≥ 56px */}
          <Button
            type="button"
            data-testid="ouvrier-save-comment-btn"
            onClick={handleSave}
            disabled={isLoading || isOverLimit}
            style={{
              backgroundColor: '#163958',
              color: '#FAFAF8',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '15px',
              height: '56px',
              width: '100%',
              border: '2px solid #163958',
              borderRadius: '4px',
              boxShadow: '2px 2px 0 0 #000',
              opacity: (isLoading || isOverLimit) ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Enregistrement...' : 'Enregistrer'}
          </Button>

          {/* Bouton Annuler — secondary, touch ≥ 56px */}
          <Button
            type="button"
            variant="outline"
            data-testid="ouvrier-cancel-comment-btn"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 600,
              fontSize: '15px',
              height: '56px',
              width: '100%',
              borderRadius: '4px',
            }}
          >
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
