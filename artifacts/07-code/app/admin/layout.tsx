// app/(admin)/layout.tsx
// Layout admin — sidebar fixe 240px + main-content margin-left:240px
// Proto référencé : mockups/15-admin-dashboard.html, 16-admin-chantier-detail.html
// Design system Hana §4.7 sidebar
//
// Ce layout est un Server Component.
// Il inclut TrialExpiredBanner pour afficher l'état du trial.

import { TrialExpiredBanner } from '@/components/TrialExpiredBanner'
import { SidebarNavClient } from '@/components/SidebarNavClient'
import { createClient } from '@/lib/supabase/server'
// T01 — SidebarNav extrait en Client Component SidebarNavClient (usePathname nécessite 'use client')
// Le layout admin reste Server Component — pattern Next.js 15 recommandé

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
    <div className="min-h-screen bg-cream">
      <SidebarNavClient />
      <div className="main-content">
        {/* TrialExpiredBanner — affiché si trial actif ou expiré */}
        {organisationData && (
          <TrialExpiredBanner
            statut={organisationData.statut as 'trial_active' | 'trial_expired' | 'active' | 'suspended'}
            trialEndsAt={organisationData.trial_ends_at}
          />
        )}
        {children}
      </div>
    </div>
  )
}
