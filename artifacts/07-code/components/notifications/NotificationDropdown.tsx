'use client'
// components/notifications/NotificationDropdown.tsx
// Panneau "fil d'activité" — CONTENU SEUL (data + UI).
//
// Le conteneur (DropdownMenu desktop / Sheet mobile) est choisi par NotificationBell
// via useIsMobile — UN SEUL variant monté à la fois (fix bug double-panneau smoke prod).
// Ce composant ne rend QUE le contenu du panneau (export `NotificationPanel`).
//
// Implémente : US-032 (fil d'activité, marquer lu, marquer tout lu)
// D-4V-012 : fetch lazy au premier open, optimistic local
// K4V-04 : aucun dangerouslySetInnerHTML — rendu JSX uniquement
// Sécurité : titre/message rendus en JSX (React échappe par défaut)

import { useState, useEffect, useCallback, useRef } from 'react'
import { NotificationItem } from '@/components/notifications/NotificationItem'
import { useToast } from '@/lib/hooks/use-toast'
import type { NotificationDisplay } from '@/types/database'

// ============================================================
// Types
// ============================================================

interface NotificationPanelProps {
  /** true quand le panneau est ouvert — déclenche le fetch lazy */
  open: boolean
  onClose: () => void
  onUnreadCountChange?: (count: number) => void
}

// ============================================================
// Skeleton loading
// ============================================================

function NotificationSkeleton() {
  return (
    <div
      data-testid="notification-skeleton"
      className="flex flex-col gap-3 p-4"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 items-start">
          <div
            className="rounded-full shrink-0"
            style={{
              width: 36,
              height: 36,
              backgroundColor: 'var(--color-notif-skeleton-base)',
            }}
          />
          <div className="flex-1 flex flex-col gap-2">
            <div
              className="rounded"
              style={{ height: 12, width: '70%', backgroundColor: 'var(--color-notif-skeleton-base)' }}
            />
            <div
              className="rounded"
              style={{ height: 10, width: '90%', backgroundColor: 'var(--color-notif-skeleton-shimmer)' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// Panneau (contenu seul)
// ============================================================

export function NotificationPanel({ open, onClose, onUnreadCountChange }: NotificationPanelProps) {
  const { toast } = useToast()
  const [notifications, setNotifications] = useState<NotificationDisplay[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  // Ref pour lire la valeur courante de notifications sans stale closure dans useCallback
  // (BUG-FIX ZR-DROP-01 : évite que handleRead capture une liste périmée)
  const notificationsRef = useRef<NotificationDisplay[]>(notifications)

  // Mise à jour du compteur parent
  const updateParentCount = useCallback((count: number) => {
    setUnreadCount(count)
    onUnreadCountChange?.(count)
  }, [onUnreadCountChange])

  // Wrapper setNotifications qui maintient notificationsRef en sync (BUG-FIX ZR-DROP-01)
  const setNotificationsTracked = useCallback(
    (updater: NotificationDisplay[] | ((prev: NotificationDisplay[]) => NotificationDisplay[])) => {
      setNotifications((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        notificationsRef.current = next
        return next
      })
    },
    [],
  )

  // Fetch au premier open (lazy)
  useEffect(() => {
    if (!open || fetched) return

    const fetchNotifications = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/notifications?limit=20')
        if (res.ok) {
          const json = await res.json() as { notifications: NotificationDisplay[]; unread_count: number }
          setNotificationsTracked(json.notifications)
          updateParentCount(json.unread_count)
          setFetched(true)
        }
      } catch {
        // Pas d'indicateur d'erreur V1 (specs §9 edge case)
      } finally {
        setLoading(false)
      }
    }

    fetchNotifications()
  }, [open, fetched, updateParentCount, setNotificationsTracked])

  // Marquer 1 notif lue — optimistic local
  // BUG-FIX ZR-DROP-01 : stale closure sur unreadCount capturé par l'ancienne implémentation.
  // Après : notificationsRef.current (toujours à jour via setNotificationsTracked) permet de
  //   vérifier l'état lu RÉEL de la notif ; setUnreadCount fonctionnel garantit prev correct.
  const handleRead = useCallback(async (id: string) => {
    const currentNotif = notificationsRef.current.find((n) => n.id === id)
    const wasUnread = currentNotif !== undefined && !currentNotif.lu

    // Optimistic : marquer lu localement
    setNotificationsTracked((prev) => prev.map((n) => (n.id === id ? { ...n, lu: true } : n)))

    // Décrémenter uniquement si la notif était effectivement non lue
    if (wasUnread) {
      setUnreadCount((prev) => {
        const next = Math.max(0, prev - 1)
        onUnreadCountChange?.(next)
        return next
      })
    }

    // PATCH serveur (fire and forget — best-effort UI)
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
    } catch {
      // Silencieux — l'optimistic local suffit
    }
  }, [onUnreadCountChange, setNotificationsTracked])

  // Marquer tout lu
  const handleReadAll = useCallback(async () => {
    setNotificationsTracked((prev) => prev.map((n) => ({ ...n, lu: true })))
    updateParentCount(0)

    try {
      await fetch('/api/notifications/read-all', { method: 'POST' })
    } catch {
      // Silencieux
    }

    onClose()
  }, [onClose, updateParentCount, setNotificationsTracked])

  // Handler toast si ressource disparue (appelé depuis NotificationItem)
  const handleDeadLink = useCallback(() => {
    toast({ title: 'Cette ressource n\'existe plus.' })
  }, [toast])

  return (
    <div
      data-testid="notification-dropdown"
      className="flex flex-col w-full"
      style={{ backgroundColor: 'var(--color-notif-panel-bg)' }}
    >
      {/* Header panel */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: 'var(--color-notif-panel-header-bg)' }}
      >
        <span className="font-heading font-bold text-white text-[15px]">
          Notifications
        </span>
        {unreadCount > 0 && (
          <button
            type="button"
            data-testid="notif-read-all-btn"
            onClick={handleReadAll}
            className="text-xs font-semibold text-accent hover:underline focus-visible:outline-none"
          >
            Tout marquer lu
          </button>
        )}
      </div>

      {/* Corps */}
      <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
        {loading ? (
          <NotificationSkeleton />
        ) : notifications.length === 0 ? (
          <div
            data-testid="notification-empty-state"
            className="flex flex-col items-center justify-center py-10 px-4 text-center"
          >
            <span className="text-[13px] text-muted-foreground">
              Aucune notification pour le moment.
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map((notif) => (
              <li key={notif.id}>
                <NotificationItem
                  notification={notif}
                  onRead={handleRead}
                  onDeadLink={handleDeadLink}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer — lien "Voir tout" */}
      <div className="border-t border-gray-200 px-4 py-3 text-center">
        <a
          href="/admin/notifications"
          data-testid="notif-see-all-link"
          className="text-[13px] font-semibold text-primary hover:underline"
        >
          Voir tout
        </a>
      </div>
    </div>
  )
}

export default NotificationPanel
