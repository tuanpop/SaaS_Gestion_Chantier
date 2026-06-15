// app/conducteur/rapports-hebdo/[id]/page.tsx — Détail rapport hebdo (conducteur)
// Server Component — fetch direct adminClient

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveDestinatairesInternes } from '@/lib/reporting/destinataires'
import { CrStatusBadge } from '@/components/reporting/CrStatusBadge'
import { RapportHebdoActionButtons } from '@/components/reporting/RapportHebdoActionButtons'
import { formatSemaineLabel } from '@/lib/reporting/isoWeek'
import type { RapportHebdo } from '@/types/reporting'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ConducteurRapportHebdoDetailPage({ params }: PageProps) {
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
  // Utilise resolveDestinatairesInternes pour que le compteur corresponde EXACTEMENT à l'envoi réel
  // (décision PO 2026-06-15 : admins org + conducteurs rattachés au chantier, pas tous les conducteurs)
  const nbDestinataires = (await resolveDestinatairesInternes(organisationId, rapport.chantier_id, adminClient)).length

  return (
    <div className="px-4 pb-32 max-w-2xl mx-auto">
      <div className="pt-4 mb-4">
        <Link
          href={`/conducteur/chantiers/${rapport.chantier_id}`}
          className="text-xs text-muted flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au chantier
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading font-bold text-xl mb-1">
              Rapport — {semaineLabel}
            </h1>
            <p className="text-sm text-muted">{chantierNom}</p>
          </div>
          <CrStatusBadge statut={rapport.statut} />
        </div>
      </div>

      {/* Métadonnées */}
      <div className="card-brutal-mobile p-3 mb-4 space-y-1">
        <p className="text-xs">
          <span className="text-muted">Basé sur </span>
          <span className="font-semibold">{rapport.cr_ids.length} CR(s)</span>
        </p>
        {rapport.valide_at && (
          <p className="text-xs">
            <span className="text-muted">Validé le </span>
            <span className="font-semibold">{new Date(rapport.valide_at).toLocaleDateString('fr-FR')}</span>
          </p>
        )}
        {rapport.envoye_at && (
          <p className="text-xs">
            <span className="text-muted">Envoyé le </span>
            <span className="font-semibold">{new Date(rapport.envoye_at).toLocaleDateString('fr-FR')}</span>
          </p>
        )}
      </div>

      {/* Contenu */}
      <div className="card-brutal-mobile p-4 mb-6">
        <h2 className="text-xs font-heading font-bold uppercase tracking-wide text-muted mb-2">
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
