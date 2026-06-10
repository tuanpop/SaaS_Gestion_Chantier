// app/admin/cr/[id]/page.tsx — Détail CR journalier (admin)
// Server Component — fetch direct adminClient
// Passes to CrDetailClient for interactions

import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { CrDetailClient } from './CrDetailClient'
import type { CompteRendu } from '@/types/reporting'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AdminCrDetailPage({ params }: PageProps) {
  const { id: crId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const adminClient = createAdminClient()

  // Ownership 404 cross-org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: crRaw, error } = await (adminClient as unknown as any)
    .from('comptes_rendus')
    .select('*')
    .eq('id', crId)
    .eq('organisation_id', organisationId)
    .single()

  if (error || !crRaw) return notFound()

  const cr = crRaw as unknown as CompteRendu

  // Infos chantier
  const { data: chantierRaw } = await adminClient
    .from('chantiers')
    .select('id, nom')
    .eq('id', cr.chantier_id)
    .single()

  const chantierNom = (chantierRaw as unknown as { nom: string } | null)?.nom ?? 'Chantier inconnu'

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
    <CrDetailClient
      cr={cr}
      chantierNom={chantierNom}
      basePath="/admin"
      nbDestinataires={nbDestinataires}
    />
  )
}
