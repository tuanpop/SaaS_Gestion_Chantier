// app/(admin)/chantiers/[id]/modifier/page.tsx
// Sprint 2 dette (2026-05-20) — page Modifier chantier (admin).
// Le bouton "Modifier" sur le détail pointait ici depuis Sprint 2 mais la
// route n'existait pas (404). PATCH /api/chantiers/[id] existait avec
// UpdateChantierSchema complet — seul l'écran manquait.
//
// Server Component : charge le chantier + délègue le formulaire au Client.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Chantier } from '@/types/database'
import { ModifierChantierClient } from './client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ModifierChantierPage({ params }: PageProps) {
  const { id: chantierId } = await params

  const headerStore = await headers()
  const organisationId = headerStore.get('x-organisation-id')
  const userRole = headerStore.get('x-user-role')

  if (!organisationId || userRole !== 'admin') {
    return notFound()
  }

  const adminClient = createAdminClient()

  const { data: chantierRaw, error } = await adminClient
    .from('chantiers')
    .select('*')
    .eq('id', chantierId)
    .eq('organisation_id', organisationId)
    .single()

  if (error || !chantierRaw) {
    return notFound()
  }

  const chantier = chantierRaw as unknown as Chantier

  // Un chantier archivé ne se modifie pas — l'admin doit le désarchiver d'abord
  // (cohérent avec la règle "Modifier" caché si statut='archive' dans /admin/chantiers/[id]).
  if (chantier.statut === 'archive') {
    return (
      <div>
        <Link
          href={`/admin/chantiers/${chantierId}`}
          className="text-xs text-muted flex items-center gap-1 mb-3 hover:text-primary transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Retour au chantier
        </Link>
        <div className="card-brutal p-8 mt-4 max-w-2xl">
          <h1 className="font-heading font-bold text-[22px] mb-2">Chantier archivé</h1>
          <p className="text-muted">
            Ce chantier est archivé. Désarchivez-le avant de le modifier.
          </p>
        </div>
      </div>
    )
  }

  return <ModifierChantierClient chantier={chantier} />
}
