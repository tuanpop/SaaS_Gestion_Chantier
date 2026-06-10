'use client'

// components/reporting/RapportHebdoCard.tsx — Card liste rapport hebdomadaire
// Affiche : semaine label, statut badge, nombre de CRs, lien détail

import Link from 'next/link'
import { CrStatusBadge } from './CrStatusBadge'
import { formatSemaineLabel } from '@/lib/reporting/isoWeek'
import type { RapportHebdoListe } from '@/types/reporting'

interface RapportHebdoCardProps {
  rapport: RapportHebdoListe
  /** Préfixe chemin : '/admin' ou '/conducteur' */
  basePath: '/admin' | '/conducteur'
}

export function RapportHebdoCard({ rapport, basePath }: RapportHebdoCardProps) {
  const label = formatSemaineLabel(rapport.annee_iso, rapport.semaine_iso)

  return (
    <Link
      href={`${basePath}/rapports-hebdo/${rapport.id}`}
      className="flex items-center justify-between gap-3 rounded border-2 border-black bg-white px-4 py-3 hover:bg-[#FFF3E8] transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-medium text-[#222222] shrink-0">{label}</span>
        <span className="text-xs text-[#555555] shrink-0">
          {rapport.cr_ids.length} CR{rapport.cr_ids.length > 1 ? 's' : ''}
        </span>
      </div>
      <CrStatusBadge statut={rapport.statut} />
    </Link>
  )
}
