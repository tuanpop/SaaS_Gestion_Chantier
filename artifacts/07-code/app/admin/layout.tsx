// app/(admin)/layout.tsx
// Layout admin — sidebar fixe 240px + main-content margin-left:240px
// Proto référencé : mockups/15-admin-dashboard.html, 16-admin-chantier-detail.html
// Design system Hana §4.7 sidebar
//
// Ce layout est un Server Component.
// Il inclut TrialExpiredBanner pour afficher l'état du trial.

import Link from 'next/link'
import { TrialExpiredBanner } from '@/components/TrialExpiredBanner'
import { createClient } from '@/lib/supabase/server'

// ============================================================
// Sidebar Admin
// ============================================================

function SidebarNav({ pathname }: { pathname?: string }) {
  void pathname // utilisé pour active state (voir pages individuelles)
  return (
    <nav className="sidebar">
      <div className="px-6 mb-8">
        <Link href="/admin" className="block">
          <h1 className="font-heading font-[800] text-[22px] text-white">
            <span className="text-accent">Claw</span>BTP
          </h1>
        </Link>
      </div>

      <Link href="/admin" className="flex items-center gap-3 px-6 py-3 text-[#94A3B8] hover:bg-primary hover:text-white transition-colors font-medium text-[15px]">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        Dashboard
      </Link>

      <Link href="/admin/chantiers" className="flex items-center gap-3 px-6 py-3 text-[#94A3B8] hover:bg-primary hover:text-white transition-colors font-medium text-[15px]">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Chantiers
      </Link>

      <Link href="/admin/equipe" className="flex items-center gap-3 px-6 py-3 text-[#94A3B8] hover:bg-primary hover:text-white transition-colors font-medium text-[15px]">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
        Équipe
      </Link>

      <Link href="/admin/comptabilite" className="flex items-center gap-3 px-6 py-3 text-[#94A3B8] hover:bg-primary hover:text-white transition-colors font-medium text-[15px]">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
        Comptabilité
      </Link>

      <Link href="/admin/notifications" className="flex items-center gap-3 px-6 py-3 text-[#94A3B8] hover:bg-primary hover:text-white transition-colors font-medium text-[15px]">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        Notifications
      </Link>

      <Link href="/admin/chats" className="flex items-center gap-3 px-6 py-3 text-[#94A3B8] hover:bg-primary hover:text-white transition-colors font-medium text-[15px]">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        Chats
        <span className="ml-auto bg-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
          7
        </span>
      </Link>
    </nav>
  )
}

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
      <SidebarNav />
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
