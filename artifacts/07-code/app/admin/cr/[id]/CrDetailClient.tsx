'use client'

// app/admin/cr/[id]/CrDetailClient.tsx — Interface détail CR journalier (admin)
// Affiche contenu_genere, statut, actions selon workflow (D-007 BINDING)
// TST-K5-05 : n'affiche pas note_privee_conducteur, storage_path, signed_url

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
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href={`${basePath}/chantiers/${cr.chantier_id}`}
            className="text-xs text-muted flex items-center gap-1 mb-2 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour au chantier
          </Link>
          <h1 className="font-heading font-bold text-[24px] mb-1">
            Compte rendu — {formatDateFr(cr.date_cr)}
          </h1>
          <p className="text-sm text-muted">{chantierNom}</p>
        </div>
        <CrStatusBadge statut={cr.statut} />
      </div>

      {/* Métadonnées */}
      <div className="card-brutal p-4 mb-4 space-y-1">
        <p className="text-sm">
          <span className="text-muted font-medium">Déclenché par</span>{' '}
          <span className="font-semibold">
            {cr.declenche_par === 'cron' ? 'Automatique (18h)' : 'Manuel'}
          </span>
        </p>
        {cr.valide_at && (
          <p className="text-sm">
            <span className="text-muted font-medium">Validé le</span>{' '}
            <span className="font-semibold">{formatDatetimeFr(cr.valide_at)}</span>
          </p>
        )}
        {cr.envoye_at && (
          <p className="text-sm">
            <span className="text-muted font-medium">Envoyé le</span>{' '}
            <span className="font-semibold">{formatDatetimeFr(cr.envoye_at)}</span>
          </p>
        )}
        {cr.envoye_a && (
          <p className="text-sm">
            <span className="text-muted font-medium">Destinataires</span>{' '}
            <span className="font-semibold">{cr.envoye_a}</span>
          </p>
        )}
      </div>

      {/* Contenu généré — text node, pas de dangerouslySetInnerHTML */}
      <div className="card-brutal p-4 mb-6">
        <h2 className="text-xs font-heading font-bold uppercase tracking-wide text-muted mb-3">
          Contenu du compte rendu
        </h2>
        <div
          className="text-sm leading-relaxed whitespace-pre-wrap text-[#222222]"
          data-testid="cr-contenu"
        >
          {cr.contenu_genere ?? 'Contenu non disponible.'}
        </div>
      </div>

      {/* Actions selon statut (D-007 workflow) */}
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
