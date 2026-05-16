// Root layout — Sprint 2
//
// Design system Hana (2026-05-15) : Outfit + Public Sans
// Corrige dette Sprint 1 : Plus Jakarta Sans → Outfit/Public Sans
// Les fonts sont chargées dans globals.css via @import url(...&display=swap)
//
// TanStack Query Provider : monté ici via QueryClientProviderWrapper (Client Component)
// TrialExpiredBanner : monté depuis les layouts protégés (admin, conducteur)

import type { Metadata } from 'next'
import { QueryClientProviderWrapper } from '@/components/QueryClientProviderWrapper'
import './globals.css'

// ============================================================
// Metadata Next.js 15
// ============================================================

export const metadata: Metadata = {
  title: {
    default: 'ClawBTP',
    template: '%s | ClawBTP',
  },
  description: 'Gestion de chantier BTP — suivi, équipe, rapports',
  // PWA manifest produit par Tanjiro (Sprint 8+)
}

// ============================================================
// Root Layout
// ============================================================

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr">
      {/*
        Outfit + Public Sans chargées dans globals.css via @import url(...&display=swap)
        font-heading = Outfit (headings, boutons, KPI)
        font-sans = Public Sans (corps, inputs, descriptions)
        Source : ux-design-system.md §2 Typographie
      */}
      <body className="font-sans bg-cream text-foreground antialiased">
        <QueryClientProviderWrapper>
          {children}
        </QueryClientProviderWrapper>
      </body>
    </html>
  )
}
