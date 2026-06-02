'use client'
// components/ouvrier/MotifBlocageModal.tsx
// Modal signalement blocage — Sheet bottom vaul, validation inline
//
// D-3-023 : font-size 16px sur textarea (evite le zoom iOS — piege implementation binding)
// component-mapping-sprint-3.md §3 : Sheet side="bottom" (vaul)
// Bouton confirmer : bg #C00000, height 56px

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface MotifBlocageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmer: (motif: string) => void
  isLoading?: boolean
}

const MOTIF_MIN = 3
const MOTIF_MAX = 1000

export function MotifBlocageModal({
  open,
  onOpenChange,
  onConfirmer,
  isLoading = false,
}: MotifBlocageModalProps) {
  const [motif, setMotif] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)

  function handleConfirmer() {
    const trimmed = motif.trim()
    if (trimmed.length < MOTIF_MIN) {
      setErreur(`Le motif doit contenir au moins ${MOTIF_MIN} caracteres.`)
      return
    }
    setErreur(null)
    onConfirmer(trimmed)
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      // Reset a la fermeture
      setMotif('')
      setErreur(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        style={{
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
          padding: '24px 16px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        <SheetHeader style={{ marginBottom: '20px' }}>
          <SheetTitle
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '20px',
              color: '#163958',
            }}
          >
            Signaler un blocage
          </SheetTitle>
          <SheetDescription
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '14px',
              color: '#4A4A4A',
            }}
          >
            Decrivez l&apos;obstacle qui empeche de continuer la tache.
          </SheetDescription>
        </SheetHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Textarea — font-size 16px OBLIGATOIRE (evite zoom iOS D-3-023) */}
          <div>
            <textarea
              value={motif}
              onChange={(e) => {
                setMotif(e.target.value)
                if (erreur) setErreur(null)
              }}
              placeholder="Ex. : materiau manquant, acces bloque, equipement en panne..."
              minLength={MOTIF_MIN}
              maxLength={MOTIF_MAX}
              rows={4}
              style={{
                width: '100%',
                // D-3-023 BINDING : font-size 16px sur textarea pour eviter le zoom iOS
                fontSize: '16px',
                fontFamily: '"Public Sans", sans-serif',
                lineHeight: '1.5',
                padding: '12px',
                border: erreur ? '2px solid #C00000' : '2px solid #163958',
                borderRadius: '4px',
                resize: 'vertical',
                outline: 'none',
                backgroundColor: '#FAFAF8',
                boxSizing: 'border-box',
              }}
              aria-label="Motif du blocage"
              aria-required="true"
            />
            {/* Compteur + erreur */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              {erreur ? (
                <span
                  style={{ fontFamily: '"Public Sans", sans-serif', fontSize: '12px', color: '#C00000' }}
                  role="alert"
                >
                  {erreur}
                </span>
              ) : (
                <span />
              )}
              <span
                style={{
                  fontFamily: '"Public Sans", sans-serif',
                  fontSize: '12px',
                  color: motif.length > MOTIF_MAX * 0.9 ? '#C00000' : '#888888',
                }}
              >
                {motif.length}/{MOTIF_MAX}
              </span>
            </div>
          </div>

          {/* Bouton confirmer (D-3-023 : height 56px, bg #C00000) */}
          <Button
            onClick={handleConfirmer}
            disabled={isLoading || motif.trim().length < MOTIF_MIN}
            style={{
              backgroundColor: '#C00000',
              color: '#FFFFFF',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '16px',
              height: '56px',
              border: '2px solid #C00000',
              borderRadius: '4px',
              boxShadow: '3px 3px 0 0 #000000',
              cursor: isLoading ? 'wait' : 'pointer',
              width: '100%',
            }}
          >
            {isLoading ? 'Enregistrement...' : 'Confirmer le blocage'}
          </Button>

          {/* Bouton annuler */}
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
            style={{
              fontFamily: '"Public Sans", sans-serif',
              height: '48px',
              width: '100%',
            }}
          >
            Annuler
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
