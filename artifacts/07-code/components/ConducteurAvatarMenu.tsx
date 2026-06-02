'use client'

// components/ConducteurAvatarMenu.tsx — migré DropdownMenu + Avatar (étape 7)
//
// Piège component-mapping : DropdownMenu Radix gère clickOutside nativement
//   → supprimer le useEffect clickOutside (était dans l'ancienne version)
// z-30 : menu sous le bottom-nav conducteur (z-50)

import { LogoutButton } from '@/components/LogoutButton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ConducteurAvatarMenuProps {
  /** Initiales du conducteur (2 caractères) */
  initiales: string
}

export function ConducteurAvatarMenu({ initiales }: ConducteurAvatarMenuProps) {
  return (
    // DropdownMenu Radix gère aria-expanded, aria-haspopup, et clickOutside nativement
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu utilisateur"
          className="focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 rounded-full"
        >
          <Avatar className="w-9 h-9">
            <AvatarFallback className="text-sm font-bold">{initiales}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      {/* z-30 : sous bottom-nav conducteur (z-50) */}
      <DropdownMenuContent align="end" className="z-30 min-w-[180px]">
        <DropdownMenuItem asChild>
          <LogoutButton variant="menu" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ConducteurAvatarMenu
