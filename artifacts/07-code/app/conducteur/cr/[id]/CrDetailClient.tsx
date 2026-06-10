'use client'

// app/conducteur/cr/[id]/CrDetailClient.tsx — Interface détail CR journalier (conducteur)
// Identique à admin/cr/[id]/CrDetailClient.tsx — basePath='/conducteur'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { CrStatusBadge } from '@/components/reporting/CrStatusBadge'
import { CrActionButtons } from '@/components/reporting/CrActionButtons'
import type { CompteRendu } from '@/types/reporting'

interface CrDetailClientProps {
  cr: CompteRendu
  chantierNom: string
  basePath: '/admin' | '/conducteur'
  /** Nombre de destinataires internes — calculé server-side, passé pour le dialog Envoyer */
  nbDestinataires: number
}

function formatDateFr(dateStr: string): string {
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  return `${day} ${months[month - 1]} ${year}`
}

function formatDatetimeFr(isoStr: string): string {
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  const d = new Date(isoStr)
  const day = d.getUTCDate()
  const month = months[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year} à ${h}h${m}`
}

export function CrDetailClient({ cr, chantierNom, basePath, nbDestinataires }: CrDetailClientProps) {
  return (
    <div className="px-4 pb-32 max-w-2xl mx-auto">
      {/* Header */}
      <div className="pt-4 mb-4">
        <Link
          href={`${basePath}/chantiers/${cr.chantier_id}`}
          className="text-xs text-muted flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au chantier
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading font-bold text-xl mb-1">
              CR — {formatDateFr(cr.date_cr)}
            </h1>
            <p className="text-sm text-muted">{chantierNom}</p>
          </div>
          <CrStatusBadge statut={cr.statut} />
        </div>
      </div>

      {/* Métadonnées */}
      <div className="card-brutal-mobile p-3 mb-4 space-y-1">
        <p className="text-xs">
          <span className="text-muted">Déclenché par </span>
          <span className="font-semibold">
            {cr.declenche_par === 'cron' ? 'Automatique (18h)' : 'Manuel'}
          </span>
        </p>
        {cr.valide_at && (
          <p className="text-xs">
            <span className="text-muted">Validé le </span>
            <span className="font-semibold">{formatDatetimeFr(cr.valide_at)}</span>
          </p>
        )}
        {cr.envoye_at && (
          <p className="text-xs">
            <span className="text-muted">Envoyé le </span>
            <span className="font-semibold">{formatDatetimeFr(cr.envoye_at)}</span>
          </p>
        )}
      </div>

      {/* Contenu généré — text node uniquement (pas de dangerouslySetInnerHTML) */}
      <div className="card-brutal-mobile p-4 mb-6">
        <h2 className="text-xs font-heading font-bold uppercase tracking-wide text-muted mb-2">
          Compte rendu
        </h2>
        <div
          className="text-sm leading-relaxed whitespace-pre-wrap text-[#222222]"
          data-testid="cr-contenu"
        >
          {cr.contenu_genere ?? 'Contenu non disponible.'}
        </div>
      </div>

      {/* Actions */}
      <CrActionButtons
        crId={cr.id}
        chantierId={cr.chantier_id}
        statut={cr.statut}
        basePath={basePath}
        nbDestinataires={nbDestinataires}
      />
    </div>
  )
}
