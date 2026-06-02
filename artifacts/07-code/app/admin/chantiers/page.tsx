// app/(admin)/chantiers/page.tsx
// Portefeuille multi-chantiers — liste colorée, tri rouge>orange>vert
// Server Component — data fetching direct via createClient()
//
// Proto référencé : mockups/15-admin-dashboard.html (section "Marge par chantier")
// Design system Hana : grille 3 colonnes, card-brutal + pastille coloration
// Implémente : US-010 S1 S3 (liste + perf < 1s)
//
// Sprint 2 dette (2026-05-20) — Tabs "Actifs / Archivés" :
//   l'archive soft-delete (statut='archive', D-013 RGPD) cachait totalement
//   les chantiers. Le tab "Archivés" permet de les retrouver et d'utiliser
//   le bouton "Désarchiver" sur le détail. Source : remonté pendant smoke
//   manuel post-Sprint 2 dette par le PO.

import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowDownUp, Plus, Building2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculerCouleur, trierParCouleur } from '@/lib/coloration'
import { ChantierCard } from '@/components/ChantierCard'
import { logger } from '@/lib/logger'
import type { Chantier, ChantierWithColoration } from '@/types/database'
import { Button } from '@/components/ui/button'
import { ChantiersTabsNav } from './_components/ChantiersTabsNav'

export const metadata = {
  title: 'Chantiers',
}

// Désactiver le cache Next.js (no-store) — données temps réel (US-010 S3)
export const dynamic = 'force-dynamic'

// ============================================================
// Types
// ============================================================

type Tab = 'actifs' | 'archives'

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

// ============================================================
// Page
// ============================================================

export default async function ChantiersAdminPage({ searchParams }: PageProps) {
  // T-01 — organisation_id et role lus depuis les headers injectés par le middleware,
  // jamais depuis app_metadata directement (pattern cohérent avec les routes API).
  // await headers() OBLIGATOIRE — Next.js 15 (D-011).
  const headerStore = await headers()
  const organisationId = headerStore.get('x-organisation-id')
  const userRole = headerStore.get('x-user-role')

  if (!organisationId || userRole !== 'admin') {
    // Le middleware aurait dû bloquer — fail-safe défense en profondeur.
    return (
      <div className="card-brutal p-8 text-center">
        <p className="text-danger font-semibold">Session invalide. Reconnectez-vous.</p>
      </div>
    )
  }

  const sp = await searchParams
  const activeTab: Tab = sp.tab === 'archives' ? 'archives' : 'actifs'
  const statutFilter = activeTab === 'archives' ? 'archive' : 'actif'

  const adminClient = createAdminClient()

  // Compteurs pour les tabs (deux head:true queries pour count seulement)
  const [actifsCountRes, archivesCountRes] = await Promise.all([
    adminClient
      .from('chantiers')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', organisationId)
      .eq('statut', 'actif'),
    adminClient
      .from('chantiers')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', organisationId)
      .eq('statut', 'archive'),
  ])
  const countActifs = actifsCountRes.count ?? 0
  const countArchives = archivesCountRes.count ?? 0

  // Liste du tab actif. Tri différencié :
  //   actifs    → date_fin_prevue ascendante (les plus urgents en premier)
  //   archivés  → date_fin_reelle descendante (les plus récemment archivés en premier)
  const orderColumn = activeTab === 'archives' ? 'date_fin_reelle' : 'date_fin_prevue'
  const orderAsc = activeTab !== 'archives'

  const { data: chantiersRaw, error } = await adminClient
    .from('chantiers')
    .select('*')
    .eq('organisation_id', organisationId)
    .eq('statut', statutFilter)
    .order(orderColumn, { ascending: orderAsc, nullsFirst: false })

  const chantiers = (chantiersRaw ?? []) as unknown as Chantier[]
  const aujourdhui = new Date()

  // Calculer couleur (utilisée pour le badge même si archivé — voir ChantierCard
  // qui neutralise les couleurs et affiche le badge "Archivé").
  const chantiersColores: ChantierWithColoration[] = chantiers.map((c) => ({
    ...c,
    couleur: calculerCouleur(
      {
        date_fin_prevue: c.date_fin_prevue,
        budget_alloue: c.budget_alloue,
        budget_depense: c.budget_depense,
      },
      aujourdhui,
    ),
  }))

  // Pour les actifs, conserver le tri par couleur (rouge > orange > vert).
  // Pour les archivés, conserver l'ordre DB (date_fin_reelle desc) — la couleur
  // n'a plus de sens métier sur un chantier terminé.
  const chantiersAffichés = activeTab === 'archives'
    ? chantiersColores
    : trierParCouleur(chantiersColores)

  // ============================================================
  // T07 — Compteurs tâches + ouvriers par chantier
  // Pertinent uniquement sur l'onglet actifs (les archivés affichent l'historique figé).
  // ============================================================

  const chantiersIds = chantiers.map((c) => c.id)
  const tachesParChantier = new Map<string, number>()
  const tachesTermineesParChantier = new Map<string, number>()
  const ouvriersParChantier = new Map<string, number>()

  if (chantiersIds.length > 0) {
    const t0 = performance.now()

    const [tachesResult, ouvriersResult] = await Promise.all([
      adminClient
        .from('taches')
        .select('chantier_id, statut')
        .in('chantier_id', chantiersIds)
        .eq('organisation_id', organisationId),
      adminClient
        .from('affectations')
        .select('chantier_id, user_id')
        .in('chantier_id', chantiersIds)
        .eq('organisation_id', organisationId)
        .is('date_fin', null),
    ])

    const elapsed = performance.now() - t0
    if (elapsed > 500) {
      logger.warn({ elapsedMs: elapsed.toFixed(0), chantiersCount: chantiersIds.length }, 'T07 compteurs: requêtes agrégation lentes')
    }

    for (const row of (tachesResult.data ?? [])) {
      const r = row as { chantier_id: string; statut: string }
      tachesParChantier.set(r.chantier_id, (tachesParChantier.get(r.chantier_id) ?? 0) + 1)
      if (r.statut === 'termine') {
        tachesTermineesParChantier.set(r.chantier_id, (tachesTermineesParChantier.get(r.chantier_id) ?? 0) + 1)
      }
    }

    const seenAff = new Set<string>()
    for (const row of (ouvriersResult.data ?? [])) {
      const aff = row as { chantier_id: string; user_id: string }
      const key = `${aff.chantier_id}:${aff.user_id}`
      if (!seenAff.has(key)) {
        seenAff.add(key)
        ouvriersParChantier.set(aff.chantier_id, (ouvriersParChantier.get(aff.chantier_id) ?? 0) + 1)
      }
    }
  }

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6">
        <div>
          <h1 className="font-heading font-bold text-[28px]">Chantiers</h1>
          <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
            {activeTab === 'actifs' ? (
              <>
                <ArrowDownUp className="w-3.5 h-3.5" />
                Trié par priorité : Dépassé → Dérive → Dans les temps
              </>
            ) : (
              <>Triés par date d&apos;archivage (plus récents en premier)</>
            )}
            {error && <span className="text-danger ml-2">Erreur de chargement</span>}
          </p>
        </div>
        <Button asChild size="sm" data-testid="nouveau-chantier-btn">
          <Link href="/admin/chantiers/nouveau">
            <Plus className="w-4 h-4" />
            Nouveau chantier
          </Link>
        </Button>
      </div>

      {/* Tabs Actifs / Archivés — ChantiersTabsNav (Client Component wrappant <Tabs> shadcn)
          Radix Tabs : ARIA role=tablist, keyboard navigation, data-[state=active]
          URL sync via useRouter.push dans ChantiersTabsNav */}
      <ChantiersTabsNav
        activeTab={activeTab}
        countActifs={countActifs}
        countArchives={countArchives}
      />

      {/* État vide */}
      {chantiersAffichés.length === 0 && !error && (
        <div className="card-brutal p-12 text-center">
          <Building2 className="w-16 h-16 text-muted mx-auto mb-4" />
          <p className="font-heading text-xl font-bold mb-2">
            {activeTab === 'archives' ? 'Aucun chantier archivé' : 'Aucun chantier actif'}
          </p>
          <p className="text-base text-muted mb-6">
            {activeTab === 'archives'
              ? 'Les chantiers archivés depuis le détail apparaîtront ici.'
              : 'Créez votre premier chantier pour commencer le suivi.'}
          </p>
          {activeTab === 'actifs' && (
            <Button asChild>
              <Link href="/admin/chantiers/nouveau">Créer un chantier</Link>
            </Button>
          )}
        </div>
      )}

      {/* Erreur DB */}
      {error && (
        <div className="card-brutal p-6 border-l-4 border-l-danger bg-danger-bg mb-6">
          <p className="text-danger font-semibold">Erreur lors du chargement des chantiers.</p>
        </div>
      )}

      {/* Grille des chantiers — 3 colonnes desktop */}
      {chantiersAffichés.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {chantiersAffichés.map((chantier) => (
            <ChantierCard
              key={chantier.id}
              chantier={chantier}
              href={`/admin/chantiers/${chantier.id}`}
              variant="desktop"
              tachesCount={tachesParChantier.get(chantier.id) ?? 0}
              tachesTermineesCount={tachesTermineesParChantier.get(chantier.id) ?? 0}
              ouvriersCount={ouvriersParChantier.get(chantier.id) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
