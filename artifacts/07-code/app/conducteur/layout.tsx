// app/(conducteur)/layout.tsx
// Layout conducteur — mobile-first, max-width 390px, bottom navigation 5 onglets
// Proto référencé : mockups/08-conducteur-chantiers.html
// Design system Hana §4.9 bottom-nav, §6 Responsive (390px conducteur)
// touch-action: manipulation + overscroll-behavior: contain

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'ClawBTP',
    template: '%s | ClawBTP',
  },
}

export default function ConducteurLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mobile-interface">
      <div className="max-w-[390px] mx-auto min-h-screen bg-cream relative">
        {children}
      </div>
    </div>
  )
}
