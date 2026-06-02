'use client'
// components/ouvrier/GalerieModale.tsx
// Galerie photos lecture seule — Sheet bottom mobile, grille 2 colonnes
//
// D-052/PO-3-02 : lecture seule Sprint 3 (pas d'upload, pas de delete)
// D-3-024 : photos uniquement pour les taches is_mine=true

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import type { PhotoOuvrier } from '@/types/database'

interface GalerieModaleProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photos: PhotoOuvrier[]
  tacheTitre: string
  photosTruncated?: boolean | undefined
}

export function GalerieModale({
  open,
  onOpenChange,
  photos,
  tacheTitre,
  photosTruncated,
}: GalerieModaleProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        style={{
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
          padding: '24px 16px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          maxHeight: '80dvh',
          overflowY: 'auto',
        }}
      >
        <SheetHeader style={{ marginBottom: '16px' }}>
          <SheetTitle
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '18px',
              color: '#163958',
            }}
          >
            Photos — {tacheTitre}
          </SheetTitle>
          <SheetDescription
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '13px',
              color: '#666666',
            }}
          >
            {photos.length === 0
              ? 'Aucune photo pour cette tache'
              : `${photos.length} photo${photos.length > 1 ? 's' : ''}`}
            {photosTruncated && ' (affichage limite a 50 — sprint 4 pour voir toutes les photos)'}
          </SheetDescription>
        </SheetHeader>

        {photos.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '32px 16px',
              color: '#888888',
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '14px',
            }}
          >
            Aucune photo pour cette tache
          </div>
        ) : (
          /* Grille 2 colonnes */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            {photos.map((photo, index) => (
              <div
                key={photo.id}
                style={{
                  aspectRatio: '1',
                  overflow: 'hidden',
                  borderRadius: '4px',
                  border: '2px solid #E5E7EB',
                  backgroundColor: '#F0F4F8',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  // D-3-024 : alt obligatoire sur chaque image
                  alt={`Photo ${index + 1} de ${photos.length}`}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Note lecture seule Sprint 3 (D-052/PO-3-02) */}
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '12px',
            color: '#888888',
            marginTop: '16px',
            textAlign: 'center',
          }}
        >
          Consultation uniquement — ajout de photos disponible prochainement
        </p>
      </SheetContent>
    </Sheet>
  )
}
