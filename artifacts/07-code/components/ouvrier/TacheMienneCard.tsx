'use client'
// components/ouvrier/TacheMienneCard.tsx
// Carte tache assignee a cet ouvrier — vue complete avec boutons de transition
//
// D-3-008 BINDING : props STRICTEMENT DISJOINTES de TacheAutreCard
// K3-HI-03 : pas de prop isMine partagee — la distinction est encodee dans les types
// D-3-023 : touch targets >= 56px sur tous les boutons
// component-mapping-sprint-3.md : variantes boutons selon statut courant
//
// Sprint 4 breaking changes (D-4-007) :
//   - TacheMienne.photos: PhotoOuvrierDisplay[] (remplace photos_count: number)
//   - Prop ouvrierUserId ajoutee pour GalerieModale
//   - Badge count = photos.length (pas photos_count)
//   - Callbacks onUploadSuccess, onDeleteSuccess, onUpdateCommentaire

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatutBadge } from './StatutBadge'
import { MotifBlocageModal } from './MotifBlocageModal'
import { GalerieModale } from './GalerieModale'
import type { TacheMienne, PhotoOuvrierDisplay } from '@/types/database'

// Props STRICTEMENT DISJOINTES de TacheAutreCardProps (D-3-008)
interface TacheMienneCardProps {
  tache: TacheMienne
  ouvrierUserId: string  // Sprint 4 — pour GalerieModale is_mine (D-4-007)
  onChangerStatut: (
    tacheId: string,
    statut: 'a_faire' | 'en_cours' | 'termine' | 'bloque',
    bloqueRaison?: string,
  ) => void
  isLoading?: boolean
}

export function TacheMienneCard({
  tache,
  ouvrierUserId,
  onChangerStatut,
  isLoading = false,
}: TacheMienneCardProps) {
  const [blocageModalOpen, setBlocageModalOpen] = useState(false)
  const [galerieOpen, setGalerieOpen] = useState(false)
  // Sprint 4 — photos locales (optimistic update sans re-fetch)
  const [photos, setPhotos] = useState<PhotoOuvrierDisplay[]>(tache.photos ?? [])

  // Callbacks pour GalerieModale (optimistic updates)
  function handleUploadSuccess(photo: PhotoOuvrierDisplay) {
    setPhotos((prev) => [photo, ...prev]) // photo la plus recente en premier
  }

  function handleDeleteSuccess(photoId: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
  }

  function handleUpdateCommentaire(photoId: string, commentaire: string | null) {
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, commentaire } : p))
  }

  function handleDemarrer() {
    onChangerStatut(tache.id, 'en_cours')
  }

  function handleTerminer() {
    onChangerStatut(tache.id, 'termine')
  }

  function handleLeverObstacle() {
    onChangerStatut(tache.id, 'en_cours')
  }

  function handleConfirmerBlocage(motif: string) {
    setBlocageModalOpen(false)
    onChangerStatut(tache.id, 'bloque', motif)
  }

  // Boutons selon le statut courant
  function renderButtons() {
    switch (tache.statut) {
      case 'a_faire':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button
              onClick={handleDemarrer}
              disabled={isLoading}
              data-testid="ouvrier-btn-demarrer"
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
                boxShadow: '2px 2px 0 0 #000000',
              }}
            >
              Demarrer
            </Button>
            <Button
              onClick={() => setBlocageModalOpen(true)}
              disabled={isLoading}
              variant="outline"
              data-testid="ouvrier-btn-signaler-blocage"
              style={{
                color: '#C00000',
                borderColor: '#C00000',
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 600,
                height: '56px',
                width: '100%',
                borderRadius: '4px',
              }}
            >
              Signaler un blocage
            </Button>
          </div>
        )

      case 'en_cours':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button
              onClick={handleTerminer}
              disabled={isLoading}
              data-testid="ouvrier-btn-terminer"
              style={{
                backgroundColor: '#065F46',
                color: '#FAFAF8',
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 700,
                fontSize: '15px',
                height: '56px',
                width: '100%',
                border: '2px solid #065F46',
                borderRadius: '4px',
                boxShadow: '2px 2px 0 0 #000000',
              }}
            >
              Terminer
            </Button>
            <Button
              onClick={() => setBlocageModalOpen(true)}
              disabled={isLoading}
              variant="outline"
              data-testid="ouvrier-btn-signaler-blocage"
              style={{
                color: '#C00000',
                borderColor: '#C00000',
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 600,
                height: '56px',
                width: '100%',
                borderRadius: '4px',
              }}
            >
              Signaler un blocage
            </Button>
          </div>
        )

      case 'bloque':
        return (
          <Button
            onClick={handleLeverObstacle}
            disabled={isLoading}
            data-testid="ouvrier-btn-lever-obstacle"
            style={{
              backgroundColor: '#856404',
              color: '#FAFAF8',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '15px',
              height: '56px',
              width: '100%',
              border: '2px solid #856404',
              borderRadius: '4px',
              boxShadow: '2px 2px 0 0 #000000',
            }}
          >
            L&apos;obstacle est leve
          </Button>
        )

      case 'termine':
        return (
          <p
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '14px',
              color: '#065F46',
              fontWeight: 600,
              textAlign: 'center',
              padding: '8px',
            }}
          >
            Tache completee
          </p>
        )

      default:
        return null
    }
  }

  // D-4-007 : count = photos.length (photos_count supprime)
  const photosCount = photos.length

  return (
    <>
      <div
        data-testid="ouvrier-tache-mienne-card"
        style={{
          backgroundColor: '#FFFFFF',
          border: '2px solid #163958',
          borderRadius: '4px',
          padding: '16px',
          boxShadow: '3px 3px 0 0 #000000',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Titre + badge statut */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
          <h3
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '16px',
              color: '#163958',
              margin: 0,
              flex: 1,
            }}
          >
            {tache.titre}
          </h3>
          <StatutBadge statut={tache.statut} />
        </div>

        {/* Description complete */}
        {tache.description_complete && (
          <p
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '14px',
              color: '#4A4A4A',
              lineHeight: '1.5',
              margin: 0,
            }}
          >
            {tache.description_complete}
          </p>
        )}

        {/* Motif blocage si statut bloque */}
        {tache.statut === 'bloque' && tache.bloque_raison && (
          <div
            style={{
              backgroundColor: '#FFE4E4',
              border: '1px solid #C00000',
              borderRadius: '4px',
              padding: '8px 12px',
            }}
          >
            <p
              style={{
                fontFamily: '"Public Sans", sans-serif',
                fontSize: '13px',
                color: '#C00000',
                margin: 0,
              }}
            >
              <strong>Blocage :</strong> {tache.bloque_raison}
            </p>
          </div>
        )}

        {/* Date echeance */}
        {tache.date_echeance && (
          <p
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '12px',
              color: '#888888',
              margin: 0,
            }}
          >
            Echeance : {new Date(tache.date_echeance).toLocaleDateString('fr-FR')}
          </p>
        )}

        {/* Bouton galerie photos — count = photos.length (D-4-007 breaking change) */}
        <button
          onClick={() => setGalerieOpen(true)}
          data-testid="ouvrier-galerie-photos-trigger"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'transparent',
            border: '1px solid #E5E7EB',
            borderRadius: '4px',
            padding: '8px 12px',
            cursor: 'pointer',
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '13px',
            color: '#4A4A4A',
          }}
          aria-label={
            photosCount === 0
              ? 'Voir la galerie (aucune photo)'
              : `Voir ${photosCount} photo${photosCount > 1 ? 's' : ''}`
          }
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          {photosCount === 0
            ? 'Photos — Ajouter'
            : `${photosCount} photo${photosCount > 1 ? 's' : ''}`}
        </button>

        {/* Boutons d'action */}
        <div>{renderButtons()}</div>
      </div>

      {/* Modal signalement blocage */}
      <MotifBlocageModal
        open={blocageModalOpen}
        onOpenChange={setBlocageModalOpen}
        onConfirmer={handleConfirmerBlocage}
        isLoading={isLoading}
      />

      {/* Galerie photos étendue Sprint 4 (D-4-007) */}
      <GalerieModale
        open={galerieOpen}
        onOpenChange={setGalerieOpen}
        photos={photos}
        tacheTitre={tache.titre}
        tacheId={tache.id}
        ouvrierUserId={ouvrierUserId}
        photosTruncated={tache.photos_truncated}
        onUploadSuccess={handleUploadSuccess}
        onDeleteSuccess={handleDeleteSuccess}
        onUpdateCommentaire={handleUpdateCommentaire}
      />
    </>
  )
}
