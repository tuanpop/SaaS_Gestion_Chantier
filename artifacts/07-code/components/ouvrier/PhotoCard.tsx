'use client'
// components/ouvrier/PhotoCard.tsx
// Carte photo individuelle dans GalerieModale (maquette 02-galerie-modale-sprint-4.html)
//
// Items securite :
//   K4-HI-06 : referrerpolicy="no-referrer" sur <img src={signed_url}>
//   K4-LOW-11 : commentaire rendu en text node React (jamais innerHTML/dangerouslySetInnerHTML)
//
// Props :
//   photo       : PhotoOuvrierDisplay (sans storage_path — D-4-006)
//   ouvrierUserId : user_id de la session ouvrier (pour determiner is_mine cote UI)
//   onEditComment : callback -> EditCommentairePhotoModal (si is_mine)
//   onDelete      : callback -> ConfirmDeletePhotoDialog (si is_mine)

import type { PhotoOuvrierDisplay } from '@/types/database'

interface PhotoCardProps {
  photo: PhotoOuvrierDisplay
  ouvrierUserId: string
  onEditComment?: () => void
  onDelete?: () => void
}

export function PhotoCard({ photo, ouvrierUserId, onEditComment, onDelete }: PhotoCardProps) {
  const isMine = photo.uploader_id === ouvrierUserId

  return (
    <div
      data-testid="ouvrier-photo-card"
      style={{
        border: '2px solid #000000',
        borderRadius: '4px',
        boxShadow: '3px 3px 0 0 #000000',
        overflow: 'hidden',
        backgroundColor: '#F0F4F8',
        aspectRatio: '1',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Image — K4-HI-06 : referrerpolicy="no-referrer" BINDING */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.signed_url}
          // K4-HI-06 BINDING : referrerpolicy="no-referrer" sur tout img signed_url
          referrerPolicy="no-referrer"
          alt={photo.commentaire ?? `Photo du ${new Date(photo.created_at).toLocaleDateString('fr-FR')}`}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        {/* Badge "Ma photo" si is_mine */}
        {isMine && (
          <div
            style={{
              position: 'absolute',
              top: '4px',
              left: '4px',
              backgroundColor: '#163958',
              color: '#FAFAF8',
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '3px',
            }}
            aria-hidden="true"
          >
            Ma photo
          </div>
        )}
      </div>

      {/* Footer : commentaire + date + actions */}
      <div
        style={{
          padding: '6px 8px',
          backgroundColor: '#FFFFFF',
          borderTop: '1.5px solid #E5E7EB',
        }}
      >
        {/* Commentaire — K4-LOW-11 : text node React, JAMAIS dangerouslySetInnerHTML */}
        {photo.commentaire && (
          <p
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '11px',
              color: '#4A4A4A',
              margin: '0 0 4px 0',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {/* K4-LOW-11 BINDING : text node (pas de HTML injecte) */}
            {photo.commentaire}
          </p>
        )}

        {/* Date */}
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '10px',
            color: '#888888',
            margin: 0,
          }}
        >
          {new Date(photo.created_at).toLocaleDateString('fr-FR')}
        </p>

        {/* Actions is_mine */}
        {isMine && (
          <div
            style={{
              display: 'flex',
              gap: '6px',
              marginTop: '6px',
            }}
          >
            {/* Icône crayon — édition commentaire */}
            <button
              type="button"
              onClick={onEditComment}
              data-testid="ouvrier-photo-edit-comment"
              aria-label="Modifier le commentaire"
              style={{
                // Touch target ≥ 36×36px (spec maquette 02)
                minWidth: '36px',
                minHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#F0F4F8',
                border: '1.5px solid #E5E7EB',
                borderRadius: '4px',
                cursor: 'pointer',
                flex: 1,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#163958" strokeWidth="2" aria-hidden="true">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>

            {/* Icône poubelle — suppression */}
            <button
              type="button"
              onClick={onDelete}
              data-testid="ouvrier-photo-delete"
              aria-label="Supprimer la photo"
              style={{
                minWidth: '36px',
                minHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#C00000',
                border: '1.5px solid #C00000',
                borderRadius: '4px',
                cursor: 'pointer',
                flex: 1,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
