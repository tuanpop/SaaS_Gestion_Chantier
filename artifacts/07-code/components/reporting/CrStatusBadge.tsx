'use client'

// components/reporting/CrStatusBadge.tsx — Badge statut CR / rapport hebdo
// Statuts : brouillon (warning) | valide (success) | envoye (primary)
// Design Neubrutalism BTP — hérite de Badge ui

import { Badge } from '@/components/ui/badge'
import type { StatutCR, StatutRapportHebdo } from '@/types/reporting'

type AnyStatut = StatutCR | StatutRapportHebdo

const STATUT_CONFIG: Record<
  AnyStatut,
  { label: string; variant: 'warning' | 'success' | 'primary' }
> = {
  brouillon: { label: 'Brouillon', variant: 'warning' },
  valide: { label: 'Validé', variant: 'success' },
  envoye: { label: 'Envoyé', variant: 'primary' },
}

interface CrStatusBadgeProps {
  statut: AnyStatut
  className?: string
}

export function CrStatusBadge({ statut, className }: CrStatusBadgeProps) {
  const config = STATUT_CONFIG[statut] ?? STATUT_CONFIG['brouillon']
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  )
}
