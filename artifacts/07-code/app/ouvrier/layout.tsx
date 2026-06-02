// app/ouvrier/layout.tsx
// Layout mobile ouvrier — max 430px, pas de sidebar, header sticky
// D-3-023 : design tokens mobile ouvrier, touch targets 56px, safe-area inset

import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/toaster'

export const metadata: Metadata = {
  title: 'ClawBTP — Espace Ouvrier',
  description: 'Votre espace de travail chantier',
}

export default function OuvrierLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        // D-3-023 : centrage + max-width 430px (format mobile portrait)
        maxWidth: '430px',
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        // Background cream — design-system-sprint-3.md tokens
        backgroundColor: '#FAFAF8',
      }}
    >
      {/* Header sticky — couleur primaire BTP D-3-023 */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: '64px',
          backgroundColor: '#163958',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '16px',
          paddingRight: '16px',
          boxShadow: '0 2px 0 0 #000000',
        }}
      >
        <span
          style={{
            color: '#FAFAF8',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '18px',
            letterSpacing: '0.5px',
          }}
        >
          ClawBTP
        </span>
      </header>

      {/* Contenu principal */}
      <main
        style={{
          flex: 1,
          padding: '16px',
          // safe-area-inset-bottom pour les devices iOS (notch, home indicator)
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          fontFamily: '"Public Sans", sans-serif',
        }}
      >
        {children}
      </main>

      {/* Toaster pour les notifications de statut */}
      <Toaster />
    </div>
  )
}
