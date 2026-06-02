// app/admin/layout.tsx — Sprint 2.5 patch v2
// Layout admin responsive — pattern AdTomate (Shell flex + sidebar sticky hidden md:flex + Sheet mobile)
// D-2.5-020 — pas de darkMode classes
// TrialExpiredBanner préservé, fetch organisation inchangé
// [CORRECTION 2026-05-22] : wrapper flex obligatoire + prop inSheet sur SidebarNavClient

import { TrialExpiredBanner } from '@/components/TrialExpiredBanner'
import { SidebarNavClient } from '@/components/SidebarNavClient'
import { MobileAdminTopbar } from '@/components/MobileAdminTopbar'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { createClient } from '@/lib/supabase/server'
// T01 — SidebarNav extrait en Client Component SidebarNavClient (usePathname nécessite 'use client')
// Le layout admin reste Server Component — pattern Next.js 15 recommandé
// Sheet est un Context Provider Radix côté client ; ses children Server Components sont valides (Next.js 15)

// ============================================================
// Layout
// ============================================================

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Récupérer les données organisation pour TrialExpiredBanner
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let organisationData: { statut: string; trial_ends_at: string } | null = null

  if (user?.app_metadata?.['organisation_id']) {
    const { data } = await supabase
      .from('organisations')
      .select('statut, trial_ends_at')
      .eq('id', user.app_metadata['organisation_id'] as string)
      .single()

    if (data) {
      organisationData = data as { statut: string; trial_ends_at: string }
    }
  }

  return (
    <Sheet>
      {/* [CORRECTION 2026-05-22] Wrapper flex obligatoire — Sheet Radix n'apporte aucun display:flex.
          Sans ce div, flex-1 du contenu principal n'a pas de parent flex et le layout se casse. */}
      <div className="min-h-screen flex bg-cream">
        {/* Sidebar desktop — default inSheet=false → wrapper `hidden md:flex sticky top-0 h-screen` */}
        <SidebarNavClient />

        {/* Contenu principal */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header mobile — md:hidden, contient SheetTrigger (contexte partagé via Sheet parent) */}
          <MobileAdminTopbar />

          <main className="flex-1 min-w-0 p-4 md:p-8">
            {/* TrialExpiredBanner — affiché si trial actif ou expiré */}
            {organisationData && (
              <TrialExpiredBanner
                statut={organisationData.statut as 'trial_active' | 'trial_expired' | 'active' | 'suspended'}
                trialEndsAt={organisationData.trial_ends_at}
              />
            )}
            {children}
          </main>
        </div>
      </div>

      {/* SheetContent — sidebar mobile drawer.
          Sibling du div flex (hors du flex container) — Radix monte via portal sur document.body.
          [CORRECTION 2026-05-22] inSheet prop sur SidebarNavClient → h-full, pas de hidden md:flex */}
      <SheetContent
        side="left"
        className="p-0 w-[280px] bg-[#163958] border-r-2 border-black"
      >
        {/* R-04 : SheetTitle accessible obligatoire (Radix DialogContent requirement) */}
        <SheetTitle className="sr-only">Navigation admin</SheetTitle>
        <SidebarNavClient inSheet />
      </SheetContent>
    </Sheet>
  )
}
