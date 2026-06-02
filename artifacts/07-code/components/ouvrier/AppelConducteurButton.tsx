'use client'
// components/ouvrier/AppelConducteurButton.tsx
// Bouton appel conducteur — lien <a href="tel:"> natif
//
// RG-NO-AFFECTATION-003 : si telephone null → bouton disabled + Tooltip
// component-mapping-sprint-3.md §4 : height 64px (CTA critique)

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

interface AppelConducteurButtonProps {
  telephone: string | null
}

export function AppelConducteurButton({ telephone }: AppelConducteurButtonProps) {
  if (telephone) {
    // Telephone disponible — lien <a href="tel:"> natif (RG-NO-AFFECTATION-003)
    return (
      <a
        href={`tel:${telephone}`}
        data-testid="ouvrier-appel-conducteur-btn"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          height: '64px',
          backgroundColor: '#163958',
          color: '#FAFAF8',
          fontFamily: 'Outfit, sans-serif',
          fontWeight: 700,
          fontSize: '18px',
          border: '2px solid #163958',
          borderRadius: '4px',
          boxShadow: '3px 3px 0 0 #000000',
          textDecoration: 'none',
          width: '100%',
        }}
        aria-label={`Appeler le responsable au ${telephone}`}
      >
        {/* Icone telephone */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
        Appeler le responsable
      </a>
    )
  }

  // Telephone null — bouton disabled + Tooltip
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            disabled
            data-testid="ouvrier-appel-conducteur-btn"
            style={{
              height: '64px',
              width: '100%',
              backgroundColor: '#E5E7EB',
              color: '#9CA3AF',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '16px',
              cursor: 'not-allowed',
              border: '2px solid #E5E7EB',
              borderRadius: '4px',
            }}
            aria-label="Numero non disponible"
          >
            Appeler le responsable
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p style={{ fontFamily: '"Public Sans", sans-serif', fontSize: '13px' }}>
            Numero non disponible — contactez votre responsable
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
