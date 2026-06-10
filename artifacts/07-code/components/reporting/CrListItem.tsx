'use client'

// components/reporting/CrListItem.tsx — Item liste CR journalier
// Affiche : date, statut badge, lien vers détail

import Link from 'next/link'
import { CrStatusBadge } from './CrStatusBadge'
import type { CompteRenduListe } from '@/types/reporting'

interface CrListItemProps {
  cr: CompteRenduListe
  /** Préfixe chemin : '/admin' ou '/conducteur' */
  basePath: '/admin' | '/conducteur'
}

function formatDateFr(dateStr: string): string {
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  return `${day} ${months[month - 1]} ${year}`
}

export function CrListItem({ cr, basePath }: CrListItemProps) {
  return (
    <Link
      href={`${basePath}/cr/${cr.id}`}
      className="flex items-center justify-between gap-3 rounded border-2 border-black bg-white px-4 py-3 hover:bg-[#FFF3E8] transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-medium text-[#222222] shrink-0">
          {formatDateFr(cr.date_cr)}
        </span>
        <span className="text-xs text-[#555555] truncate">
          {cr.declenche_par === 'cron' ? 'Automatique' : 'Manuel'}
        </span>
      </div>
      <CrStatusBadge statut={cr.statut} />
    </Link>
  )
}
