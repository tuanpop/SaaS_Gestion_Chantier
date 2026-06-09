'use client'
// components/ouvrier/UploadPhotoButton.tsx
// Bouton déclencheur d'upload photo dans GalerieModale (maquette 01-upload-photo-ouvrier-sprint-4.html)
//
// Flux :
//   1. Clic -> trigger <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment">
//   2. Validation client UX (taille > 10Mo, MIME hors whitelist) -> error-banner
//   3. POST multipart/form-data -> /api/photos (avec tache_id, file, commentaire)
//   4. Après 201 : appelle onUploadSuccess(photo: PhotoOuvrierDisplay)
//
// Decision PO (A1 HEIC RETIRE) : accept="image/jpeg,image/png,image/webp" uniquement
//   Le serveur reste le vrai garde (validateImageBuffer). La validation client est UX uniquement.
//
// K4-CR-01 : validation client = aide UX, PAS une garantie securite (serveur est autoritaire)
// K4-HI-03 : pas de décompression serveur (magic-bytes uniquement)

import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import type { PhotoOuvrierDisplay } from '@/types/database'

const MAX_SIZE = 10 * 1024 * 1024 // 10 Mo (validation UX client)
// HEIC RETIRE (D-056/PO-4-02 amende 2026-06-07 — whitelist stricte)
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp']

interface UploadPhotoButtonProps {
  tacheId: string
  onUploadSuccess: (photo: PhotoOuvrierDisplay) => void
}

export function UploadPhotoButton({ tacheId, onUploadSuccess }: UploadPhotoButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorType, setErrorType] = useState<'size' | 'format' | 'server' | null>(null)

  function handleTrigger() {
    if (isLoading) return
    setErrorType(null)
    inputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset input pour permettre de re-selectionner le meme fichier
    e.target.value = ''

    // Validation UX client — taille (K4-CR-01 : serveur reste l'autorite)
    if (file.size > MAX_SIZE) {
      setErrorType('size')
      return
    }

    // Validation UX client — MIME (whitelist stricte JPEG/PNG/WebP — A1 PO 2026-06-07)
    if (!ALLOWED_MIMES.includes(file.type)) {
      setErrorType('format')
      return
    }

    setErrorType(null)
    setIsLoading(true)

    try {
      // POST multipart/form-data (D-4-001 : jamais d'upload direct client -> Storage)
      const formData = new FormData()
      formData.append('tache_id', tacheId)
      formData.append('file', file)
      // commentaire optionnel — pas de champ ici, editble post-upload via EditCommentairePhotoModal

      const response = await fetch('/api/photos', {
        method: 'POST',
        body: formData,
        // NE PAS definir Content-Type — le navigateur le fait avec le boundary multipart
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        if (response.status === 429) {
          setErrorType('server') // rate limit
        } else {
          setErrorType('server')
        }
        // Log le message d'erreur pour le debug (pas de console.log — lib/logger cote serveur)
        void data
        return
      }

      const photo = await response.json() as PhotoOuvrierDisplay
      onUploadSuccess(photo)
    } catch {
      setErrorType('server')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Input file masque — accept sans HEIC (A1 PO 2026-06-07).
          PAS de `capture` : laisse le choix caméra OU galerie sur mobile (retour smoke D1).
          `capture="environment"` forçait la caméra et masquait l'option galerie. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* Bouton 80×80px dashed (maquette 01) */}
      <button
        type="button"
        onClick={handleTrigger}
        disabled={isLoading}
        data-testid="ouvrier-upload-photo-trigger"
        aria-label="Ajouter une photo"
        style={{
          width: '80px',
          height: '80px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          border: '2px dashed #F97316', // orange BTP (design-system)
          borderRadius: '8px',
          backgroundColor: '#FFF7ED',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontFamily: '"Public Sans", sans-serif',
          fontSize: '11px',
          color: '#F97316',
          fontWeight: 600,
          opacity: isLoading ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {isLoading ? (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#F97316"
            strokeWidth="2"
            aria-hidden="true"
            style={{ animation: 'spin 1s linear infinite' }}
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
            <path d="M12 2a10 10 0 0110 10" strokeLinecap="round"/>
          </svg>
        ) : (
          <Camera size={24} color="#F97316" aria-hidden="true" />
        )}
        <span>{isLoading ? '...' : 'Ajouter\nphoto'}</span>
      </button>

      {/* Banners d'erreur UX (K4-CR-01 : UX seulement, serveur reste l'autorite) */}
      {errorType === 'size' && (
        <div
          data-testid="ouvrier-upload-error-size"
          role="alert"
          style={{
            backgroundColor: '#FFE4E4',
            border: '1.5px solid #C00000',
            borderRadius: '4px',
            padding: '8px 10px',
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '12px',
            color: '#C00000',
          }}
        >
          Le fichier dépasse 10 Mo. Choisissez une image plus petite.
        </div>
      )}

      {errorType === 'format' && (
        <div
          data-testid="ouvrier-upload-error-format"
          role="alert"
          style={{
            backgroundColor: '#FFE4E4',
            border: '1.5px solid #C00000',
            borderRadius: '4px',
            padding: '8px 10px',
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '12px',
            color: '#C00000',
          }}
        >
          Format non supporté. Formats acceptés : JPEG, PNG, WebP.
        </div>
      )}

      {errorType === 'server' && (
        <div
          data-testid="ouvrier-upload-error-server"
          role="alert"
          style={{
            backgroundColor: '#FFE4E4',
            border: '1.5px solid #C00000',
            borderRadius: '4px',
            padding: '8px 10px',
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '12px',
            color: '#C00000',
          }}
        >
          Erreur lors de l&apos;envoi. Réessayez.
        </div>
      )}
    </div>
  )
}
