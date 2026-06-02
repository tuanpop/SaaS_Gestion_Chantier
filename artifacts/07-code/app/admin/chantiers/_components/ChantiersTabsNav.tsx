'use client'
// app/admin/chantiers/_components/ChantiersTabsNav.tsx
// Client Component wrappant <Tabs> shadcn pour la navigation Actifs / Archivés.
//
// Pattern : le Server Component (chantiers/page.tsx) passe activeTab + compteurs en prop
// et ce CC gère l'UI Radix + pousse l'URL via useRouter.
// Préserve data-testid="tab-chantiers-actifs" / "tab-chantiers-archives" pour Levi Sprint 2.6.
// Pas de sync searchParams dans ce CC — la valeur initiale vient du SC via prop.
//
// K2.5-T-07 : pas de dangerouslySetInnerHTML
// D-2.5-019 : périmètre icônes exemptées — non concerné (composant tabs uniquement)

import { useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface ChantiersTabsNavProps {
  activeTab: 'actifs' | 'archives'
  countActifs: number
  countArchives: number
}

export function ChantiersTabsNav({ activeTab, countActifs, countArchives }: ChantiersTabsNavProps) {
  const router = useRouter()

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (value === 'archives') {
          router.push('/admin/chantiers?tab=archives')
        } else {
          router.push('/admin/chantiers')
        }
      }}
      className="mb-6"
    >
      <TabsList>
        <TabsTrigger value="actifs" data-testid="tab-chantiers-actifs">
          Actifs ({countActifs})
        </TabsTrigger>
        <TabsTrigger value="archives" data-testid="tab-chantiers-archives">
          Archivés ({countArchives})
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
