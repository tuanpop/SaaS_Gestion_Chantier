'use client'
// components/notifications/NotificationBell.tsx
// Client Component — polling setInterval 30s + badge + ouverture dropdown
//
// Implémente : US-031 (badge non-lus), D-4V-012 (polling), D-4V-013 (ouvrier hors scope)
// K4V-04 : aucun dangerouslySetInnerHTML
// K4V-14 : clearInterval cleanup useEffect (NFR — anti memory-leak PWA)
// Sécurité : pas d'exposition d'infos sensibles, rendu JSX uniquement

import { useState, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown'

// ============================================================
// Props
// ============================================================

interface NotificationBellProps {
  /** Compte initial non-lus (SSR hint, optionnel) */
  initialUnreadCount?: number
}

// ============================================================
// Composant
// ============================================================

export function NotificationBell({ initialUnreadCount = 0 }: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [open, setOpen] = useState(false)

  // Polling 30s — D-4V-012, PO-4V-06 A
  // K4V-14 : cleanup clearInterval OBLIGATOIRE (anti memory-leak PWA)
  // BUG-FIX ZR-BELL-01 : fetch immédiat au mount (évite badge périmé pendant 30s si
  // initialUnreadCount absent ou périmé au moment du rendu SSR)
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

    // Fetch immédiat au mount, puis toutes les 30s
    fetchCount()
    const id = setInterval(fetchCount, 30_000)
    return () => clearInterval(id)  // K4V-14 OBLIGATOIRE
  }, [])

  const handleOpen = () => setOpen(true)
  const handleClose = () => setOpen(false)

  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount)

  return (
    <div
      className="relative"
      data-testid="notification-bell-wrapper"
    >
      <button
        type="button"
        aria-label={
          unreadCount > 0
            ? `Notifications — ${unreadCount > 99 ? '99+' : unreadCount} non lue${unreadCount > 1 ? 's' : ''}`
            : 'Notifications'
        }
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="notification-bell-trigger"
        onClick={handleOpen}
        className="relative flex items-center justify-center min-h-[44px] min-w-[44px] rounded-[6px] text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

      <NotificationDropdown
        open={open}
        onClose={handleClose}
        onUnreadCountChange={setUnreadCount}
      />
    </div>
  )
}

export default NotificationBell
