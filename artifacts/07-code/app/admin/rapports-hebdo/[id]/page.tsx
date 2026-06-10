// app/admin/rapports-hebdo/[id]/page.tsx — Détail rapport hebdo (admin)
// Server Component — fetch direct adminClient

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { CrStatusBadge } from '@/components/reporting/CrStatusBadge'
import { RapportHebdoActionButtons } from '@/components/reporting/RapportHebdoActionButtons'
import { formatSemaineLabel } from '@/lib/reporting/isoWeek'
import type { RapportHebdo } from '@/types/reporting'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AdminRapportHebdoDetailPage({ params }: PageProps) {
  const { id: rapportId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const adminClient = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rapportRaw, error } = await (adminClient as unknown as any)
    .from('rapports_hebdo')
    .select('*')
    .eq('id', rapportId)
    .eq('organisation_id', organisationId)
    .single()

  if (error || !rapportRaw) return notFound()

  const rapport = rapportRaw as unknown as RapportHebdo

  const { data: chantierRaw } = await adminClient
    .from('chantiers')
    .select('id, nom')
    .eq('id', rapport.chantier_id)
    .single()

  const chantierNom = (chantierRaw as unknown as { nom: string } | null)?.nom ?? 'Chantier inconnu'
  const semaineLabel = formatSemaineLabel(rapport.annee_iso, rapport.semaine_iso)

  // Comptage des destinataires internes pour le dialog Envoyer (PO-5-04)
  // Même population que resolveDestinatairesInternes : role IN (admin,conducteur) AND deleted_at IS NULL
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: nbDestinatairesRaw } = await (adminClient as unknown as any)
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', organisationId)
    .in('role', ['admin', 'conducteur'])
    .is('deleted_at', null)

  const nbDestinataires = (nbDestinatairesRaw as number | null) ?? 0

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href={`/admin/chantiers/${rapport.chantier_id}`}
            className="text-xs text-muted flex items-center gap-1 mb-2 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour au chantier
          </Link>
          <h1 className="font-heading font-bold text-[24px] mb-1">
            Rapport hebdo — {semaineLabel}
          </h1>
          <p className="text-sm text-muted">{chantierNom}</p>
        </div>
        <CrStatusBadge statut={rapport.statut} />
      </div>

      {/* Métadonnées */}
      <div className="card-brutal p-4 mb-4 space-y-1">
        <p className="text-sm">
          <span className="text-muted font-medium">CRs sources</span>{' '}
          <span className="font-semibold">{rapport.cr_ids.length} compte(s) rendu(s) journalier(s)</span>
        </p>
        {rapport.valide_at && (
          <p className="text-sm">
            <span className="text-muted font-medium">Validé le</span>{' '}
            <span className="font-semibold">{new Date(rapport.valide_at).toLocaleDateString('fr-FR')}</span>
          </p>
        )}
        {rapport.envoye_at && (
          <p className="text-sm">
            <span className="text-muted font-medium">Envoyé le</span>{' '}
            <span className="font-semibold">{new Date(rapport.envoye_at).toLocaleDateString('fr-FR')}</span>
          </p>
        )}
        {rapport.envoye_a && (
          <p className="text-sm">
            <span className="text-muted font-medium">Destinataires</span>{' '}
            <span className="font-semibold">{rapport.envoye_a}</span>
          </p>
        )}
      </div>

      {/* Contenu généré */}
      <div className="card-brutal p-4 mb-6">
        <h2 className="text-xs font-heading font-bold uppercase tracking-wide text-muted mb-3">
          Synthèse hebdomadaire
        </h2>
        <div
          className="text-sm leading-relaxed whitespace-pre-wrap text-[#222222]"
          data-testid="rapport-hebdo-contenu"
        >
          {rapport.contenu_genere ?? 'Contenu non disponible.'}
        </div>
      </div>

      {/* Actions */}
      <RapportHebdoActionButtons
        rapportId={rapport.id}
        chantierId={rapport.chantier_id}
        statut={rapport.statut}
        nbDestinataires={nbDestinataires}
      />
    </div>
  )
}
