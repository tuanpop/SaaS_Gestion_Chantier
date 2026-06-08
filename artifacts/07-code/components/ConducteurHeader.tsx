'use client'
// components/ConducteurHeader.tsx — Sprint 4 Visibilité
// Header partagé conducteur : chrome minimal (logo + NotificationBell + ConducteurAvatarMenu)
//
// PO décision binding (HITL) : Option B fusion propre SANS store
// Le titre contextuel reste dans le <main> de chaque page (pas de prop titre au layout)
// Ce composant porte UNIQUEMENT le chrome (barre top persistante sur toutes les pages conducteur)
//
// Utilisé dans : app/conducteur/layout.tsx
// K4V-04 : aucun dangerouslySetInnerHTML — rendu JSX uniquement
// D-4V-013 : ouvrier hors scope — ce composant N'EST PAS rendu dans le layout ouvrier

import Link from 'next/link'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { ConducteurAvatarMenu } from '@/components/ConducteurAvatarMenu'

// ============================================================
// Props
// ============================================================

interface ConducteurHeaderProps {
  /** Initiales du conducteur pour ConducteurAvatarMenu */
  initiales: string
}

// ============================================================
// Composant
// ============================================================

export function ConducteurHeader({ initiales }: ConducteurHeaderProps) {
  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-[#163958] border-b-2 border-black"
    >
      {/* Logo / marque ClawBTP */}
      <Link href="/conducteur/chantiers" className="block">
        <span className="font-heading font-[800] text-[20px] text-white">
          {/* RG-DS-006 : logo ClawBTP préservé */}
          <span className="text-accent">Claw</span>BTP
        </span>
      </Link>

      {/* Chrome droite : NotificationBell + ConducteurAvatarMenu */}
      <div className="flex items-center gap-2">
        <NotificationBell />
        <ConducteurAvatarMenu initiales={initiales} />
      </div>
    </header>
  )
}

export default ConducteurHeader
