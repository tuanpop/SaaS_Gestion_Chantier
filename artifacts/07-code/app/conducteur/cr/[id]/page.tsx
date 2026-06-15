// app/conducteur/cr/[id]/page.tsx — Détail CR journalier (conducteur)
// Server Component — fetch direct adminClient, ownership filtre par JWT org

import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveDestinatairesInternes } from '@/lib/reporting/destinataires'
import { CrDetailClient } from './CrDetailClient'
import type { CompteRendu } from '@/types/reporting'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ConducteurCrDetailPage({ params }: PageProps) {
  const { id: crId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const adminClient = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: crRaw, error } = await (adminClient as unknown as any)
    .from('comptes_rendus')
    .select('*')
    .eq('id', crId)
    .eq('organisation_id', organisationId)
    .single()

  if (error || !crRaw) return notFound()

  const cr = crRaw as unknown as CompteRendu

  const { data: chantierRaw } = await adminClient
    .from('chantiers')
    .select('id, nom')
    .eq('id', cr.chantier_id)
    .single()

  const chantierNom = (chantierRaw as unknown as { nom: string } | null)?.nom ?? 'Chantier inconnu'

  // Comptage des destinataires internes pour le dialog Envoyer (PO-5-04)
  // Utilise resolveDestinatairesInternes pour que le compteur corresponde EXACTEMENT à l'envoi réel
  // (décision PO 2026-06-15 : admins org + conducteurs rattachés au chantier, pas tous les conducteurs)
  const nbDestinataires = (await resolveDestinatairesInternes(organisationId, cr.chantier_id, adminClient)).length

  return (
    <CrDetailClient
      cr={cr}
      chantierNom={chantierNom}
      basePath="/conducteur"
      nbDestinataires={nbDestinataires}
    />
  )
}
