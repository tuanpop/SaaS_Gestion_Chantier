'use client'
// components/ouvrier/StatutBadge.tsx
// Badge de statut de tache ouvrier
// design-system-sprint-3.md : tokens couleur statuts --color-statut-*

import type { TacheStatut } from '@/types/database'

interface StatutBadgeProps {
  statut: TacheStatut
  size?: 'sm' | 'md'
}

// Tokens couleur depuis design-system-sprint-3.md
const STATUT_CONFIG: Record<TacheStatut, { label: string; bg: string; color: string; border: string }> = {
  a_faire: {
    label: 'A faire',
    bg: '#F0F4F8',
    color: '#163958',
    border: '#163958',
  },
  en_cours: {
    label: 'En cours',
    bg: '#FFF3CD',
    color: '#856404',
    border: '#856404',
  },
  bloque: {
    label: 'Bloque',
    bg: '#FFE4E4',
    color: '#C00000',
    border: '#C00000',
  },
  termine: {
    label: 'Termine',
    bg: '#D1FAE5',
    color: '#065F46',
    border: '#065F46',
  },
}

export function StatutBadge({ statut, size = 'md' }: StatutBadgeProps) {
  const config = STATUT_CONFIG[statut]
  const fontSize = size === 'sm' ? '11px' : '12px'
  const padding = size === 'sm' ? '2px 8px' : '4px 10px'

  return (
    <span
      aria-label={`Statut : ${config.label}`}
      style={{
        display: 'inline-block',
        backgroundColor: config.bg,
        color: config.color,
        border: `1.5px solid ${config.border}`,
        borderRadius: '4px',
        fontFamily: '"Public Sans", sans-serif',
        fontWeight: 700,
        fontSize,
        padding,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      {config.label}
    </span>
  )
}
