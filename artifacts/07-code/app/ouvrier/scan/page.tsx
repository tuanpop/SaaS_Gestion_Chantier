'use client'
// app/ouvrier/scan/page.tsx
// Page /ouvrier/scan — Instructions scan QR + messages d'erreur contextuel
// Client Component pour lire useSearchParams (erreur depuis le handler QR)
//
// Public — pas de session requise (OUVRIER_PUBLIC_ROUTES dans middleware.ts)
// Items securite : messages d'erreur generiques (K3-I-02 — pas de details techniques)

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'

// ============================================================
// Messages d'erreur contextuel (K3-I-02 : generiques — pas de details techniques)
// ============================================================
const ERROR_MESSAGES: Record<string, string> = {
  invalid_token:
    'Ce QR code est invalide ou a expiré. Demandez un nouveau QR code à votre responsable.',
  user_not_found:
    'Compte introuvable. Contactez votre responsable de chantier.',
  server_error:
    'Une erreur temporaire s\'est produite. Réessayez dans quelques instants.',
}

function ScanPageContent() {
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  const errorMessage = errorParam ? (ERROR_MESSAGES[errorParam] ?? ERROR_MESSAGES['server_error']) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingTop: '32px' }}>
      {/* Message d'erreur contextuel */}
      {errorMessage && (
        <Alert
          variant="destructive"
          data-testid="ouvrier-scan-error-message"
          style={{ border: '2px solid #C00000', borderRadius: '4px' }}
        >
          <AlertDescription
            style={{ fontFamily: '"Public Sans", sans-serif', fontSize: '14px' }}
          >
            {errorMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Instructions principales */}
      <div style={{ textAlign: 'center', paddingTop: '16px' }}>
        {/* Icone QR placeholder */}
        <div
          style={{
            width: '120px',
            height: '120px',
            border: '3px solid #163958',
            borderRadius: '8px',
            margin: '0 auto 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F0F4F8',
          }}
          aria-hidden="true"
        >
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#163958"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <line x1="14" y1="14" x2="14" y2="14" />
            <line x1="17" y1="14" x2="21" y2="14" />
            <line x1="14" y1="17" x2="14" y2="21" />
            <line x1="17" y1="17" x2="21" y2="17" />
            <line x1="17" y1="21" x2="21" y2="21" />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '22px',
            color: '#163958',
            marginBottom: '12px',
          }}
        >
          Scanner votre QR code
        </h1>

        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '16px',
            color: '#4A4A4A',
            lineHeight: '1.5',
            maxWidth: '320px',
            margin: '0 auto',
          }}
        >
          Scannez votre QR code avec l&apos;appareil photo de votre telephone.
          Votre responsable vous a fourni ce QR code.
        </p>
      </div>

      {/* Note aide */}
      <div
        style={{
          backgroundColor: '#F0F4F8',
          border: '1px solid #163958',
          borderRadius: '4px',
          padding: '12px 16px',
        }}
      >
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '13px',
            color: '#163958',
            margin: 0,
          }}
        >
          <strong>Pas de QR code ?</strong> Contactez votre responsable de chantier pour
          qu&apos;il vous génère un accès.
        </p>
      </div>
    </div>
  )
}

export default function OuvrierScanPage() {
  return (
    <Suspense fallback={
      <div style={{ textAlign: 'center', paddingTop: '32px', fontFamily: '"Public Sans", sans-serif' }}>
        Chargement...
      </div>
    }>
      <ScanPageContent />
    </Suspense>
  )
}
