// components/EnvBanner.tsx
// Bandeau sticky rouge "PREVIEW" conditionné sur NEXT_PUBLIC_ENV_LABEL
//
// SECURITY: K2.5-CR-02 — bandeau obligatoire preview non-prod
// SECURITY: K2.5-S-03 — identification visuelle environnement non-prod
// W001 (Itachi) — bandeau d'environnement préventif

import type { ReactElement } from 'react'

export function EnvBanner(): ReactElement | null {
  const envLabel = process.env.NEXT_PUBLIC_ENV_LABEL

  // Retourne null si undefined ou 'production'
  if (!envLabel || envLabel === 'production') {
    return null
  }

  return (
    // SECURITY: K2.5-CR-02 — bandeau sticky top-0, z-50, bg-danger, texte blanc, h-8
    <div
      className="sticky top-0 z-50 flex h-8 items-center justify-center bg-[#C00000] text-white text-xs font-heading font-bold"
      role="status"
      aria-label={`Environnement de prévisualisation : ${envLabel}`}
    >
      PREVIEW — {envLabel} — pas la production
    </div>
  )
}
