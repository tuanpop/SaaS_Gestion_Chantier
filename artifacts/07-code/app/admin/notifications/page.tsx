'use client'
// app/admin/notifications/page.tsx — Sprint 4 Visibilité
// Page dédiée notifications admin — liste paginée + "Tout marquer lu"
//
// Implémente : US-035 (admin visualise toutes ses notifs), US-036 (marque tout lu)
// SidebarNavClient inclut déjà le lien /admin/notifications — ce fichier le rend accessible.
//
// Architecture :
//   - Client Component (interactions fetch + read-all + pagination cursor-based)
//   - GET /api/notifications?limit=20&cursor=... (cursor-based, max 20 enforced server-side)
//   - POST /api/notifications/read-all (marque tout lu)
//   - K4V-01 : IDOR guard géré server-side (API filtre par claims headers)
//   - K4V-04 : aucun dangerouslySetInnerHTML — JSX uniquement

import { useCallback, useEffect, useRef, useState } from 'react'
import { NotificationItem } from '@/components/notifications/NotificationItem'
import { logger } from '@/lib/logger'
import type { NotificationDisplay } from '@/types/database'

// ============================================================
// Types locaux
// ============================================================

interface NotifPage {
  notifications: NotificationDisplay[]
  unread_count: number
  next_cursor: string | null
}

// ============================================================
// Composant
// ============================================================

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationDisplay[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [readAllLoading, setReadAllLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }

  // Fetch initial
  const fetchFirst = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?limit=20', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: NotifPage = await res.json()
      setNotifications(data.notifications)
      setUnreadCount(data.unread_count)
      setNextCursor(data.next_cursor)
    } catch (err) {
      logger.warn({ err }, 'AdminNotificationsPage: fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchFirst()
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [fetchFirst])

  // Charger plus (cursor-based)
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const url = `/api/notifications?limit=20&cursor=${encodeURIComponent(nextCursor)}`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: NotifPage = await res.json()
      setNotifications((prev) => [...prev, ...data.notifications])
      setUnreadCount(data.unread_count)
      setNextCursor(data.next_cursor)
    } catch (err) {
      logger.warn({ err }, 'AdminNotificationsPage: loadMore failed')
      showToast('Erreur lors du chargement.')
    } finally {
      setLoadingMore(false)
    }
  }

  // Marquer une notification lue (optimistic local)
  const handleRead = useCallback(async (id: string) => {
    // Optimistic update local
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lu: true, read_at: new Date().toISOString() } : n)),
    )
    setUnreadCount((c) => Math.max(0, c - 1))

    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        credentials: 'include',
      })
    } catch (err) {
      logger.warn({ err, id }, 'AdminNotificationsPage: PATCH read failed')
    }
  }, [])

  const handleDeadLink = useCallback(() => {
    showToast('Cette ressource a été supprimée.')
  }, [])

  // Marquer tout lu
  const handleReadAll = async () => {
    if (readAllLoading) return
    setReadAllLoading(true)
    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Mise à jour locale optimistic
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, lu: true, read_at: n.read_at ?? new Date().toISOString() })),
      )
      setUnreadCount(0)
      showToast('Toutes les notifications ont été marquées comme lues.')
    } catch (err) {
      logger.warn({ err }, 'AdminNotificationsPage: read-all failed')
      showToast('Erreur lors du marquage.')
    } finally {
      setReadAllLoading(false)
    }
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* En-tête page */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading font-bold text-2xl text-[var(--color-text-primary)]">
            Notifications
          </h1>
          {unreadCount > 0 && (
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              {unreadCount} non {unreadCount > 1 ? 'lues' : 'lue'}
            </p>
          )}
        </div>
        {/* Bouton Tout marquer lu */}
        {unreadCount > 0 && (
          <button
            type="button"
            data-testid="notif-read-all-btn"
            onClick={handleReadAll}
            disabled={readAllLoading}
            className="text-sm font-medium text-accent hover:text-accent/80 disabled:opacity-50 transition-colors px-3 py-1.5 border border-accent rounded-[6px]"
          >
            {readAllLoading ? 'En cours…' : 'Tout marquer lu'}
          </button>
        )}
      </div>

      {/* Toast feedback */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 px-4 py-2.5 rounded-[6px] bg-[var(--color-notif-panel-bg)] border border-black text-sm font-medium"
        >
          {/* K4V-04 : texte brut JSX, pas de dangerouslySetInnerHTML */}
          {toast}
        </div>
      )}

      {/* Liste */}
      <div
        className="rounded-[6px] border-2 border-black overflow-hidden"
        data-testid="notification-dropdown"
      >
        {/* État chargement */}
        {loading && (
          <div data-testid="notification-skeleton" className="divide-y divide-black/10">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <div
                  className="shrink-0 rounded-full"
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: 'var(--color-notif-skeleton-base)',
                  }}
                />
                <div className="flex-1 flex flex-col gap-1.5">
                  <div
                    className="rounded"
                    style={{
                      height: 14,
                      width: '60%',
                      backgroundColor: 'var(--color-notif-skeleton-base)',
                    }}
                  />
                  <div
                    className="rounded"
                    style={{
                      height: 12,
                      width: '80%',
                      backgroundColor: 'var(--color-notif-skeleton-shimmer)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* État vide */}
        {!loading && notifications.length === 0 && (
          <div
            data-testid="notification-empty-state"
            className="flex flex-col items-center justify-center py-16 px-4 text-center"
          >
            <svg
              className="w-12 h-12 text-[var(--color-text-muted)] mb-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            <p className="font-heading font-bold text-[15px] text-[var(--color-text-primary)]">
              Aucune notification
            </p>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
              Vous verrez ici les alertes et mises à jour importantes.
            </p>
          </div>
        )}

        {/* Liste des notifications */}
        {!loading && notifications.length > 0 && (
          <div className="divide-y divide-black/10">
            {notifications.map((notif) => (
              <NotificationItem
                key={notif.id}
                notification={notif}
                onRead={handleRead}
                onDeadLink={handleDeadLink}
                role="admin"
              />
            ))}
          </div>
        )}
      </div>

      {/* Bouton Charger plus (cursor-based pagination) */}
      {nextCursor && !loading && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            data-testid="notif-see-all-link"
            onClick={loadMore}
            disabled={loadingMore}
            className="text-sm font-medium text-accent hover:text-accent/80 disabled:opacity-50 transition-colors px-4 py-2 border border-accent rounded-[6px]"
          >
            {loadingMore ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      )}
    </div>
  )
}
