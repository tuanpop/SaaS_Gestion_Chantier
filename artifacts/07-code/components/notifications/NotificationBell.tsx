'use client'
// components/notifications/NotificationBell.tsx
// Client Component — polling setInterval 30s + badge + ouverture du panneau.
//
// FIX smoke prod Sprint 4 (double panneau + dropdown clippé) :
//  - UN SEUL conteneur monté selon le viewport (useIsMobile) — les portails Radix
//    échappent au CSS responsive, donc on choisit en JS (jamais les deux à la fois).
//  - Desktop : DropdownMenu ancré sur LA CLOCHE (DropdownMenuTrigger asChild) — Radix
//    gère le positionnement + collision (plus de span sr-only mal positionné).
//  - Mobile : Sheet bas-d'écran (thumb-reach), ouvert par la cloche.
//
// Implémente : US-031 (badge non-lus), D-4V-012 (polling), D-4V-013 (ouvrier hors scope)
// K4V-04 : aucun dangerouslySetInnerHTML
// K4V-14 : clearInterval cleanup useEffect (NFR — anti memory-leak PWA)

import { useState, useEffect } from 'react'
import { Bell } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { NotificationPanel } from '@/components/notifications/NotificationDropdown'
import { useIsMobile } from '@/lib/hooks/use-is-mobile'

interface NotificationBellProps {
  /** Compte initial non-lus (SSR hint, optionnel) */
  initialUnreadCount?: number
}

export function NotificationBell({ initialUnreadCount = 0 }: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()

  // Polling 30s — D-4V-012, PO-4V-06 A
  // K4V-14 : cleanup clearInterval OBLIGATOIRE (anti memory-leak PWA)
  // BUG-FIX ZR-BELL-01 : fetch immédiat au mount (évite badge périmé pendant 30s)
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/notifications/unread-count', {
          headers: { 'Cache-Control': 'no-store' },
        })
        if (res.ok) {
          const json = await res.json() as { unread_count: number }
          setUnreadCount(json.unread_count)
        }
      } catch {
        // Polling silencieux — si offline, garde le dernier count connu (specs §9 edge case)
      }
    }

    fetchCount()
    const id = setInterval(fetchCount, 30_000)
    return () => clearInterval(id) // K4V-14 OBLIGATOIRE
  }, [])

  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount)
  const ariaLabel =
    unreadCount > 0
      ? `Notifications — ${badgeText} non lue${unreadCount > 1 ? 's' : ''}`
      : 'Notifications'

  // Bouton cloche — partagé desktop (trigger Radix) / mobile (ouvre le Sheet).
  // `extra` permet d'injecter onClick (mobile) ou les props du Slot Radix (desktop, asChild).
  const renderBell = (extra?: React.ComponentProps<'button'>) => (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="true"
      aria-expanded={open}
      data-testid="notification-bell-trigger"
      className="relative flex items-center justify-center min-h-[44px] min-w-[44px] rounded-[6px] text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      {...extra}
    >
      <Bell size={22} aria-hidden />
      {unreadCount > 0 && (
        <span
          aria-live="polite"
          aria-label={`${badgeText} notification${unreadCount > 1 ? 's' : ''} non lue${unreadCount > 1 ? 's' : ''}`}
          data-testid="notification-badge"
          className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[11px] font-bold leading-none px-1.5 py-0.5 min-w-[20px] h-[20px]"
          style={{
            backgroundColor: 'var(--color-notif-badge-bg)',
            color: 'var(--color-notif-badge-text)',
          }}
        >
          {badgeText}
        </span>
      )}
    </button>
  )

  // Mobile : Sheet depuis le bas, ouvert par la cloche
  if (isMobile) {
    return (
      <div className="relative" data-testid="notification-bell-wrapper">
        {renderBell({ onClick: () => setOpen(true) })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="p-0 border-t-2 border-black rounded-t-[6px] overflow-hidden"
            style={{ maxHeight: '70vh' }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Notifications</SheetTitle>
            </SheetHeader>
            <NotificationPanel
              open={open}
              onClose={() => setOpen(false)}
              onUnreadCountChange={setUnreadCount}
            />
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  // Desktop : DropdownMenu ancré sur la cloche, Radix gère collision/flip
  return (
    <div className="relative" data-testid="notification-bell-wrapper">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{renderBell()}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={8}
          className="p-0 border-2 border-black shadow-[4px_4px_0_#000] rounded-[6px] overflow-hidden w-[380px] max-w-[calc(100vw-1rem)] z-[100]"
        >
          <NotificationPanel
            open={open}
            onClose={() => setOpen(false)}
            onUnreadCountChange={setUnreadCount}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default NotificationBell
