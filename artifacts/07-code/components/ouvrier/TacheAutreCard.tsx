'use client'
// components/ouvrier/TacheAutreCard.tsx
// Carte tache d'un autre ouvrier — vue minimale (titre + statut + description tronquee)
//
// D-3-008 BINDING : props STRICTEMENT DISJOINTES de TacheMienneCard
// Aucun prop isMine partagee, pas de boutons d'action
// K3-HI-03 : defense par TypeScript compilation (types disjoints)
// D-3-025 : description_courte max 120 chars (tronquee cote API, suffix "..." si >= 120)

import type { TacheAutre } from '@/types/database'
import { StatutBadge } from './StatutBadge'

// Props STRICTEMENT DISJOINTES de TacheMienneCardProps (D-3-008)
// Ne pas ajouter de props communes avec TacheMienneCard sans decision dans DECISIONLOG.md
interface TacheAutreCardProps {
  tache: TacheAutre
}

export function TacheAutreCard({ tache }: TacheAutreCardProps) {
  // D-3-025 : suffix "..." si description_courte = exactement 120 chars (tronquee cote API)
  const description = tache.description_courte
    ? tache.description_courte.length >= 120
      ? `${tache.description_courte}…`
      : tache.description_courte
    : null

  return (
    <div
      data-testid="ouvrier-tache-autre-card"
      aria-label="Tache d'un autre membre"
      style={{
        backgroundColor: '#FFFFFF',
        border: '2px solid #E5E7EB',
        borderRadius: '4px',
        padding: '12px 16px',
        opacity: 0.85, // visuel leger pour les taches des autres
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <h3
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 600,
            fontSize: '15px',
            color: '#4A4A4A',
            margin: 0,
            flex: 1,
          }}
        >
          {tache.titre}
        </h3>
        <StatutBadge statut={tache.statut} size="sm" />
      </div>

      {description && (
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '13px',
            color: '#888888',
            marginTop: '8px',
            lineHeight: '1.4',
          }}
        >
          {description}
        </p>
      )}
    </div>
  )
}
