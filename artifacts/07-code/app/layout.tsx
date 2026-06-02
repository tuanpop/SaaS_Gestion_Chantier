// Root layout — Sprint 2.5 (migré shadcn)
//
// Additions étape 7 :
//   - <EnvBanner /> (K2.5-CR-02, K2.5-S-03, W001)
//   - <Toaster /> (RG-MIGR-004 — toast global, une seule instance)
//   - <TooltipProvider> wrapper (composant-mapping §tooltip)
//
// Design system Hana : Outfit + Public Sans
// QueryClientProviderWrapper : TanStack Query Provider (inchangé)

import type { Metadata } from 'next'
import { QueryClientProviderWrapper } from '@/components/QueryClientProviderWrapper'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EnvBanner } from '@/components/EnvBanner'
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
        {/* SECURITY: K2.5-CR-02 — bandeau preview (null en production) */}
        <EnvBanner />
        {/* TooltipProvider doit wrapper l'app (component-mapping §tooltip) */}
        <TooltipProvider delayDuration={400}>
          <QueryClientProviderWrapper>
            {children}
          </QueryClientProviderWrapper>
        </TooltipProvider>
        {/* Toaster en root layout UNIQUEMENT — ne pas double-placer dans admin/conducteur layouts
            (component-mapping piège 8) */}
        <Toaster />
      </body>
    </html>
  )
}
