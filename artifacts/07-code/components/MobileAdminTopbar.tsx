'use client'
// components/MobileAdminTopbar.tsx — Sprint 2.5 patch v2
// Header sticky mobile (md:hidden) avec SheetTrigger hamburger + logo.
// Le <Sheet> wrapper est dans app/admin/layout.tsx — ce composant n'inclut que le trigger.
// Hana §14.3 (aria-label), §14.7 (touch target 44px min)

import { SheetTrigger } from '@/components/ui/sheet'
import { Menu } from 'lucide-react'

export function MobileAdminTopbar() {
  return (
    <header
      className="md:hidden sticky top-0 z-30 h-14 bg-[#163958] border-b-2 border-black flex items-center px-4 gap-3"
    >
      <SheetTrigger asChild>
        <button
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white rounded-[6px] border border-white/30 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Ouvrir le menu de navigation"
          data-testid="mobile-admin-menu-trigger"
        >
          <Menu size={24} aria-hidden />
        </button>
      </SheetTrigger>
      <span className="font-heading font-[800] text-[20px] text-white">
        {/* RG-DS-006 : logo <span class="text-accent">Claw</span>BTP préservé */}
        <span className="text-accent">Claw</span>BTP
      </span>
    </header>
  )
}
