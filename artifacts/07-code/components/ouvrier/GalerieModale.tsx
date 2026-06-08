'use client'
// components/ouvrier/GalerieModale.tsx
// Galerie photos ouvrier — Sheet bottom mobile (Sprint 4 : extension complète, D-4-007)
//
// Sprint 4 breaking changes (D-4-007) :
//   - Prop photos: PhotoOuvrierDisplay[] (remplace PhotoOuvrier[])
//   - Prop photos passe signed_url (plus url)
//   - Prop ouvrierUserId ajoutée (is_mine côté UI)
//   - Callbacks onUploadSuccess, onDeleteSuccess, onUpdateCommentaire
//   - Retrait message "Consultation uniquement"
//   - Upload intégré via UploadPhotoButton
//   - PhotoCard avec actions is_mine (édition + suppression)
//   - Notice troncature si photos_truncated (RG-PHOTO-007)
//
// Items securite :
//   K4-HI-06 : referrerpolicy no-referrer dans PhotoCard
//   K4-LOW-11 : commentaire text node dans PhotoCard
//   K4-MED-04 : signed_url non loguee (pino redact actif)

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { PhotoCard } from './PhotoCard'
import { UploadPhotoButton } from './UploadPhotoButton'
import { ConfirmDeletePhotoDialog } from './ConfirmDeletePhotoDialog'
import { EditCommentairePhotoModal } from './EditCommentairePhotoModal'
import type { PhotoOuvrierDisplay } from '@/types/database'

interface GalerieModaleProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photos: PhotoOuvrierDisplay[]
  tacheTitre: string
  tacheId: string
  ouvrierUserId: string
  photosTruncated?: boolean | undefined
  onUploadSuccess: (photo: PhotoOuvrierDisplay) => void
  onDeleteSuccess: (photoId: string) => void
  onUpdateCommentaire: (photoId: string, commentaire: string | null) => void
}

interface DeleteState {
  open: boolean
  photo: PhotoOuvrierDisplay | null
  isLoading: boolean
}

interface EditState {
  open: boolean
  photo: PhotoOuvrierDisplay | null
  isLoading: boolean
}

export function GalerieModale({
  open,
  onOpenChange,
  photos,
  tacheTitre,
  tacheId,
  ouvrierUserId,
  photosTruncated,
  onUploadSuccess,
  onDeleteSuccess,
  onUpdateCommentaire,
}: GalerieModaleProps) {
  const [deleteState, setDeleteState] = useState<DeleteState>({ open: false, photo: null, isLoading: false })
  const [editState, setEditState] = useState<EditState>({ open: false, photo: null, isLoading: false })

  // Suppression photo — optimistic : l'appelant (TacheMienneCard) met à jour sa liste locale
  async function handleDeleteConfirm() {
    if (!deleteState.photo) return
    setDeleteState((prev) => ({ ...prev, isLoading: true }))

    try {
      const response = await fetch(`/api/photos/${deleteState.photo.id}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 204) {
        throw new Error('Erreur lors de la suppression.')
      }

      onDeleteSuccess(deleteState.photo.id)
      setDeleteState({ open: false, photo: null, isLoading: false })
    } catch {
      setDeleteState((prev) => ({ ...prev, isLoading: false }))
    }
  }

  // Édition commentaire
  async function handleSaveCommentaire(commentaire: string | null) {
    if (!editState.photo) return
    setEditState((prev) => ({ ...prev, isLoading: true }))

    try {
      const response = await fetch(`/api/photos/${editState.photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentaire }),
      })

      if (!response.ok) {
        throw new Error('Erreur lors de la modification.')
      }

      onUpdateCommentaire(editState.photo.id, commentaire)
      setEditState({ open: false, photo: null, isLoading: false })
    } catch {
      setEditState((prev) => ({ ...prev, isLoading: false }))
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          style={{
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            padding: '24px 16px',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
            maxHeight: '85dvh',
            overflowY: 'auto',
          }}
        >
          <SheetHeader style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <SheetTitle
                style={{
                  fontFamily: 'Outfit, sans-serif',
                  fontWeight: 700,
                  fontSize: '18px',
                  color: '#163958',
                  flex: 1,
                }}
              >
                Photos — {tacheTitre}
              </SheetTitle>
              {/* Bouton "+ Ajouter" dans le header (data-testid ouvrier-galerie-add-photo) */}
              <UploadPhotoButton
                tacheId={tacheId}
                onUploadSuccess={onUploadSuccess}
              />
            </div>
            <SheetDescription
              style={{
                fontFamily: '"Public Sans", sans-serif',
                fontSize: '13px',
                color: '#666666',
              }}
            >
              {photos.length === 0
                ? 'Aucune photo pour cette tâche'
                : `${photos.length} photo${photos.length > 1 ? 's' : ''}`}
            </SheetDescription>
          </SheetHeader>

          {/* Etat vide */}
          {photos.length === 0 ? (
            <div
              data-testid="ouvrier-galerie-empty"
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: '#888888',
                fontFamily: '"Public Sans", sans-serif',
                fontSize: '14px',
              }}
            >
              Aucune photo pour cette tâche.
              <br />
              <span style={{ fontSize: '13px', color: '#AAAAAA', marginTop: '4px', display: 'block' }}>
                Ajoutez la première photo avec le bouton ci-dessus.
              </span>
            </div>
          ) : (
            <>
              {/* Notice troncature — RG-PHOTO-007 */}
              {photosTruncated && (
                <div
                  data-testid="ouvrier-galerie-truncation-notice"
                  role="status"
                  style={{
                    backgroundColor: '#FFF7ED',
                    border: '1.5px solid #F97316',
                    borderRadius: '4px',
                    padding: '8px 10px',
                    marginBottom: '12px',
                    fontFamily: '"Public Sans", sans-serif',
                    fontSize: '12px',
                    color: '#C2410C',
                  }}
                >
                  Affichage limité à 50 photos. Les plus anciennes ne sont pas affichées.
                </div>
              )}

              {/* Grille 2 colonnes */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                }}
              >
                {photos.map((photo) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    ouvrierUserId={ouvrierUserId}
                    onEditComment={() => setEditState({ open: true, photo, isLoading: false })}
                    onDelete={() => setDeleteState({ open: true, photo, isLoading: false })}
                  />
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Dialog suppression */}
      {deleteState.photo && (
        <ConfirmDeletePhotoDialog
          open={deleteState.open}
          onOpenChange={(o) => {
            if (!o) setDeleteState({ open: false, photo: null, isLoading: false })
          }}
          onConfirm={handleDeleteConfirm}
          photoSignedUrl={deleteState.photo.signed_url}
          isLoading={deleteState.isLoading}
        />
      )}

      {/* Modal édition commentaire */}
      {editState.photo && (
        <EditCommentairePhotoModal
          open={editState.open}
          onOpenChange={(o) => {
            if (!o) setEditState({ open: false, photo: null, isLoading: false })
          }}
          onSave={handleSaveCommentaire}
          initialCommentaire={editState.photo.commentaire}
          isLoading={editState.isLoading}
          photoSignedUrl={editState.photo.signed_url}
        />
      )}
    </>
  )
}
