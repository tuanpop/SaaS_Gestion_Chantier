'use client'
// components/notifications/NotificationItem.tsx
// Item individuel du fil de notifications
//
// Implémente : US-032 (navigation, marquage lu), D-4V-012
// K4V-04 : aucun dangerouslySetInnerHTML — rendu JSX uniquement
// P-06 : formatRelative inline sans lib externe (D-4V-019 : zéro nouvelle dépendance)

import { useRouter } from 'next/navigation'
import {
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  CalendarX,
  CalendarClock,
  AlertOctagon,
  Sun,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NotificationDisplay, NotificationType } from '@/types/database'

// ============================================================
// Icônes par type (spec §8.4 — design-system-sprint-4-visibilite.md §7.4)
// K4V-04 : JSX uniquement, jamais dangerouslySetInnerHTML
// ============================================================

type IconConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>
  color: string
  bgColor: string
}

const NOTIF_ICON_MAP: Record<NotificationType, IconConfig> = {
  affectation_tache:    { icon: ClipboardCheck,  color: '#3B82F6', bgColor: '#EFF6FF' },
  tache_terminee:       { icon: CheckCircle2,    color: '#22C55E', bgColor: '#F0FDF4' },
  tache_bloquee:        { icon: AlertTriangle,   color: '#EF4444', bgColor: '#FEF2F2' },
  derive_budget:        { icon: TrendingDown,    color: '#F97316', bgColor: '#FFF7ED' },
  echeance_chantier:    { icon: CalendarX,       color: '#EF4444', bgColor: '#FEF2F2' },
  echeance_tache:       { icon: CalendarClock,   color: '#F97316', bgColor: '#FFF7ED' },
  // Sprint 6 — détection proactive : ROUGE UNIQUE dans le fil de notifications (PO décision acté)
  // Le type de dérive (budget/retard/blocage/inactivité) n'est pas dans notifications.type
  // (uniquement 'derive_proactive'). La distinction de couleur par sous-type est dans la section
  // Alertes du chantier (AlertCardDerive.tsx) où le type de dérive est disponible.
  // DECISIONLOG: déviation assumée Hana S6-01 F004 (orange inactivité dans dropdown) — YAGNI.
  derive_proactive:     { icon: AlertOctagon,    color: '#EF4444', bgColor: '#FEF2F2' },
  // Sprint 7 — briefing lundi matin : BLEU (distinct du vert Rapport Hebdo)
  // data-testid: icon identifiable via notif-item-{id} parent
  briefing_lundi:       { icon: Sun,             color: '#3B82F6', bgColor: '#EFF6FF' },
}

// ============================================================
// formatRelative — P-06 inline, zéro lib externe
// ============================================================

function formatRelative(isoString: string): string {
  const now = new Date()
  const created = new Date(isoString)
  const diffMs = now.getTime() - created.getTime()
  const diffMin = Math.floor(diffMs / (1000 * 60))
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  const diffJ = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMin < 1) return "À l'instant"
  if (diffMin < 60) return `Il y a ${diffMin}min`
  if (diffH < 24) return `Il y a ${diffH}h`
  if (diffJ < 7) return `Il y a ${diffJ}j`
  return created.toLocaleDateString('fr-FR')
}

// ============================================================
// buildUrl — navigation selon type et rôle (spec §8.5)
// ============================================================

function buildUrl(
  notification: NotificationDisplay,
  role: 'admin' | 'conducteur',
): string {
  const { type, chantier_id } = notification

  if (!chantier_id) return ''

  if (role === 'admin') {
    // Sprint 6 : derive_proactive navigue vers la section #alertes du chantier
    if (type === 'derive_proactive') {
      return `/admin/chantiers/${chantier_id}#alertes`
    }
    // Sprint 7 : briefing_lundi navigue vers la section #briefing du chantier (PO décision binding)
    // Navigation directe vers briefing_id non implémentée (metadata absente des notifications)
    if (type === 'briefing_lundi') {
      return `/admin/chantiers/${chantier_id}#briefing`
    }
    return `/admin/chantiers/${chantier_id}`
  }

  // conducteur
  switch (type) {
    case 'affectation_tache':
    case 'tache_terminee':
    case 'tache_bloquee':
    case 'echeance_tache':
      return `/conducteur/chantiers/${chantier_id}`
    case 'derive_budget':
    case 'echeance_chantier':
      return `/conducteur/chantiers/${chantier_id}`
    case 'derive_proactive':
      // Sprint 6 : navigate vers section alertes du chantier conducteur
      return `/conducteur/chantiers/${chantier_id}#alertes`
    case 'briefing_lundi':
      // Sprint 7 : navigue vers section #briefing du chantier (PO décision binding)
      return `/conducteur/chantiers/${chantier_id}#briefing`
    default:
      return `/conducteur/chantiers/${chantier_id}`
  }
}

// ============================================================
// Props
// ============================================================

interface NotificationItemProps {
  notification: NotificationDisplay
  onRead: (id: string) => void
  onDeadLink?: () => void
  role?: 'admin' | 'conducteur'
}

// ============================================================
// Composant
// ============================================================

export function NotificationItem({
  notification,
  onRead,
  onDeadLink,
  role = 'admin',
}: NotificationItemProps) {
  const router = useRouter()
  const iconConfig = NOTIF_ICON_MAP[notification.type]
  const IconComponent = iconConfig.icon

  const handleClick = () => {
    // 1. Marquer lu (optimistic local dans le parent)
    onRead(notification.id)

    // 2. Si chantier_id = null → ressource disparue (specs §8.5, RG-NOTIF-012)
    if (!notification.chantier_id) {
      onDeadLink?.()
      return
    }

    // 3. Navigation vers la ressource
    const url = buildUrl(notification, role)
    if (url) {
      router.push(url)
    }
  }

  return (
    <button
      type="button"
      data-testid={`notif-item-${notification.id}`}
      data-unread={!notification.lu}
      onClick={handleClick}
      className={cn(
        'w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        !notification.lu && 'border-l-2 border-[var(--color-notif-unread-border)]',
      )}
      style={
        !notification.lu
          ? { backgroundColor: 'var(--color-notif-unread-bg)' }
          : undefined
      }
    >
      {/* Icône type — K4V-04 : JSX pur, jamais dangerouslySetInnerHTML */}
      <div
        className="shrink-0 flex items-center justify-center rounded-full"
        style={{
          width: 36,
          height: 36,
          backgroundColor: iconConfig.bgColor,
        }}
        aria-hidden
      >
        <IconComponent
          size={18}
          style={{ color: iconConfig.color }}
        />
      </div>

      {/* Contenu — K4V-04 : texte brut dans JSX, React échappe automatiquement */}
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-[14px] text-[var(--color-text-primary)] truncate">
          {/* K4V-04 : {notification.titre} — JSX échappe le HTML automatiquement */}
          {notification.titre}
        </p>
        <p className="text-[13px] text-[var(--color-text-muted)] line-clamp-2 mt-0.5">
          {/* K4V-04 : message en JSX pur. Slice large (160) pour ne pas couper une date
              en plein milieu ("...depuis le 202…") ; line-clamp-2 borne le rendu visuel. */}
          {notification.message.slice(0, 160)}
          {notification.message.length > 160 && '…'}
        </p>
        <time
          className="text-[12px] text-[var(--color-text-muted)] mt-0.5 block"
          dateTime={notification.created_at}
        >
          {formatRelative(notification.created_at)}
        </time>
      </div>

      {/* Indicateur non-lu */}
      {!notification.lu && (
        <span
          className="shrink-0 self-center rounded-full"
          aria-hidden
          style={{
            width: 8,
            height: 8,
            backgroundColor: 'var(--color-notif-dot)',
          }}
        />
      )}
    </button>
  )
}

export default NotificationItem
