// app/admin/settings/derives/page.tsx — Page "Réglages / Seuils de détection"
// US-053 (CRUD seuils admin), US-055 (reset)
//
// Server Component : fetche les seuils courants pour pré-remplir le formulaire.
// Admin uniquement (middleware redirige conducteurs hors /admin/**).
//
// data-testid : "page-seuils-derives" sur le conteneur principal.
// REACHABILITY : accessible depuis la sidebar admin > Paramètres > Alertes & Seuils.

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SEUILS_DEFAUT } from '@/types/detection'
import { SeuilsDerivesClient } from './SeuilsDerivesClient'
import type { SeuilsDerivesResponse } from '@/types/detection'

export const dynamic = 'force-dynamic'

export default async function PageSeuilsDerives() {
  // Auth server-side
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  const role = user.app_metadata?.['role'] as string | undefined

  if (!organisationId || role !== 'admin') return notFound()

  const adminClient = createAdminClient()

  // Charger les seuils courants (jamais 404 — défauts si absent)
  // TODO: remove cast after supabase gen types post-mig-015 (déviation #1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as unknown as any)
    .from('seuils_derives')
    .select('ratio_budget, jours_blocage, jours_inactivite, updated_at')
    .eq('organisation_id', organisationId)
    .maybeSingle() as {
      data: {
        ratio_budget: number
        jours_blocage: number
        jours_inactivite: number
        updated_at: string
      } | null
      error: { message: string } | null
    }

  const initialSeuils: SeuilsDerivesResponse = data
    ? {
        organisation_id: organisationId,
        ratio_budget: data.ratio_budget,
        jours_blocage: data.jours_blocage,
        jours_inactivite: data.jours_inactivite,
        source: 'db',
        updated_at: data.updated_at,
      }
    : {
        organisation_id: organisationId,
        ...SEUILS_DEFAUT,
        source: 'defaut',
        updated_at: null,
      }

  return (
    <main
      data-testid="page-seuils-derives"
      className="max-w-2xl mx-auto px-4 py-8"
    >
      {/* En-tête */}
      <div className="mb-6">
        <h1 className="font-heading font-bold text-[24px] text-[var(--color-text-primary)]">
          Seuils de détection des alertes
        </h1>
        <p className="text-[14px] text-[var(--color-text-muted)] mt-1">
          Configurez les seuils à partir desquels le système déclenche des alertes proactives
          sur vos chantiers. Ces seuils sont évalués chaque matin à 07h00 UTC.
        </p>
      </div>

      {/* Formulaire client */}
      <SeuilsDerivesClient initialSeuils={initialSeuils} />
    </main>
  )
}
