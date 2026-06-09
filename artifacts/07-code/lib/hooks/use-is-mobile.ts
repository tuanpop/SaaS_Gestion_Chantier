'use client'
// lib/hooks/use-is-mobile.ts
// Hook viewport SSR-safe — true si < breakpoint (768px = md Tailwind par défaut).
//
// Raison d'être (BUG smoke prod Sprint 4) : les composants portalés Radix
// (DropdownMenuContent / SheetContent) rendent leur contenu dans document.body,
// donc ils ÉCHAPPENT aux classes CSS responsive (`hidden md:block` / `md:hidden`)
// posées sur un wrapper. Résultat avant fix : le dropdown desktop ET le sheet mobile
// s'affichaient simultanément. Ce hook permet de ne MONTER qu'un seul variant en JS.
//
// SSR-safe : retourne `false` (desktop) au premier rendu, puis se synchronise au mount
// via matchMedia. Évite tout hydration mismatch (le serveur rend toujours desktop).

import { useState, useEffect } from 'react'

export function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [breakpointPx])

  return isMobile
}

export default useIsMobile
