'use client'
// components/ouvrier/ChantierSelectorCard.tsx
// Carte de selection de chantier pour le selecteur multi-affectations
// RG-MULTI-001 : navigation vers /ouvrier/chantiers/[id]

interface ChantierSelectorCardProps {
  chantierId: string
  chantierNom: string
}

export function ChantierSelectorCard({ chantierId, chantierNom }: ChantierSelectorCardProps) {
  return (
    <a
      href={`/ouvrier/chantiers/${chantierId}`}
      data-testid="ouvrier-chantier-selector-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        backgroundColor: '#FFFFFF',
        border: '2px solid #163958',
        borderRadius: '4px',
        boxShadow: '3px 3px 0 0 #000000',
        textDecoration: 'none',
        // D-3-023 : touch target ≥ 56px
        minHeight: '64px',
      }}
      aria-label={`Aller au chantier : ${chantierNom}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Icone batiment */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#163958"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '16px',
            color: '#163958',
          }}
        >
          {chantierNom}
        </span>
      </div>

      {/* Fleche droite */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#163958"
        strokeWidth="2"
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </a>
  )
}
