'use client'

// ============================================================
// ConducteurAvatarMenu — Avatar + menu déroulant logout conducteur
//
// R-05 (Sprint UX-2) — Décision humaine : avatar dropdown top-right
// Tap sur l'avatar ouvre un menu avec "Se déconnecter"
//
// Rendu dans app/conducteur/chantiers/page.tsx (Server Component)
// L'interactivité (useState, onClick) nécessite 'use client'
//
// z-index : le menu est en z-30, sous le bottom-nav (z-50) — pas de conflit
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { LogoutButton } from '@/components/LogoutButton'

// ============================================================
// Props
// ============================================================

interface ConducteurAvatarMenuProps {
  /** Initiales du conducteur (2 caractères) */
  initiales: string
}

// ============================================================
// Composant
// ============================================================

export function ConducteurAvatarMenu({ initiales }: ConducteurAvatarMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Fermer le menu si clic en dehors
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  return (
    <div className="relative" ref={menuRef}>
      {/* Avatar circulaire — tap pour ouvrir le menu */}
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label="Menu utilisateur"
        aria-expanded={menuOpen}
        aria-haspopup="true"
        className="w-9 h-9 rounded-full border-2 border-black bg-surface flex items-center justify-center text-sm font-bold text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
      >
        {initiales}
      </button>

      {/* Menu déroulant — z-30 (sous le bottom-nav z-50) */}
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-30 card-brutal p-3 min-w-[180px] bg-white"
        >
          <LogoutButton variant="menu" />
        </div>
      )}
    </div>
  )
}

export default ConducteurAvatarMenu
