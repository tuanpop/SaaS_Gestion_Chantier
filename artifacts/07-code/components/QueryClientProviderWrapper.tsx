'use client'

// ============================================================
// QueryClientProviderWrapper — Client wrapper pour TanStack Query
//
// Nécessaire car QueryClientProvider requiert 'use client',
// mais le root layout (app/layout.tsx) est un Server Component.
// Ce pattern est la pratique standard Next.js 15 App Router.
//
// Config mobile obligatoire (ux-design-system.md §Interface Conducteur) :
//   - staleTime: 5 * 60 * 1000  (5 minutes)
//   - refetchOnWindowFocus: false  (CRITIQUE — évite refetch intempestif sur mobile)
//   - refetchOnReconnect: true     (re-sync quand réseau revient en zone chantier)
//   - retry: 2                     (tolérance réseau instable)
// ============================================================

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface QueryClientProviderWrapperProps {
  children: React.ReactNode
}

export function QueryClientProviderWrapper({ children }: QueryClientProviderWrapperProps) {
  // useState garantit que le QueryClient est créé une seule fois par rendu côté client
  // et n'est pas partagé entre les requêtes serveur (Next.js 15 Server Components)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 5 minutes — évite les refetch inutiles sur dashboards admin
            staleTime: 5 * 60 * 1000,
            // CRITIQUE : empêche les refetch lors du focus sur mobile (retour depuis autre app)
            refetchOnWindowFocus: false,
            // Re-sync automatique quand le réseau revient (chantiers en zone couverte)
            refetchOnReconnect: true,
            // Deux tentatives avant d'exposer l'erreur à l'utilisateur
            retry: 2,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

export default QueryClientProviderWrapper
