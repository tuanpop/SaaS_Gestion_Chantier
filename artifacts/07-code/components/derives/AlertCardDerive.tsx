'use client'
// components/derives/AlertCardDerive.tsx — Carte alerte dérive individuelle
// US-049 (section alertes chantier)
//
// Sécurité :
//   TST-K6-33 : JSX pur, JAMAIS dangerouslySetInnerHTML.
//     Le texte LLM/fallback est rendu comme texte brut en JSX → React échappe automatiquement.
//   EXI-Y-K6-04 : message_llm traité comme texte non fiable (rendu JSX pur).
//
// PO décision : ROUGE UNIQUE pour derive_proactive dans la cloche (PO-6-01=A).
//   La hiérarchie de couleur par type (budget rouge / inactivité orange) est DANS cette carte
//   (où le type de dérive est disponible) — pas dans le fil de notifications.
//   F004 BINDING : badge type coloré par sévérité (rouge/orange).

import { useState } from 'react'
import { AlertOctagon } from 'lucide-react'
import Link from 'next/link'
import type { DeriveDetectee, DeriveType } from '@/types/detection'

// ============================================================
// Configuration couleurs par type (F004 BINDING)
// Critique (rouge) : budget_depasse, retard_date_fin, tache_bloquee_longue
// Warning (orange) : inactivite_chantier
// ============================================================

type SeveriteConfig = {
  badgeText: string
  badgeBg: string
  badgeText_color: string
  iconColor: string
  cardBorderColor: string
  cardBg: string
}

const DERIVE_SEVERITE: Record<DeriveType, SeveriteConfig> = {
  budget_depasse: {
    badgeText: 'Budget dépassé',
    badgeBg: 'var(--color-derive-critique-bg)',
    badgeText_color: 'var(--color-derive-critique-text)',
    iconColor: 'var(--color-alerte-rouge)',
    cardBorderColor: 'var(--color-derive-critique-border)',
    cardBg: 'var(--color-derive-critique-bg)',
  },
  retard_date_fin: {
    badgeText: 'Retard',
    badgeBg: 'var(--color-derive-critique-bg)',
    badgeText_color: 'var(--color-derive-critique-text)',
    iconColor: 'var(--color-alerte-rouge)',
    cardBorderColor: 'var(--color-derive-critique-border)',
    cardBg: 'var(--color-derive-critique-bg)',
  },
  tache_bloquee_longue: {
    badgeText: 'Tâche bloquée',
    badgeBg: 'var(--color-derive-critique-bg)',
    badgeText_color: 'var(--color-derive-critique-text)',
    iconColor: 'var(--color-alerte-rouge)',
    cardBorderColor: 'var(--color-derive-critique-border)',
    cardBg: 'var(--color-derive-critique-bg)',
  },
  inactivite_chantier: {
    badgeText: 'Inactivité',
    badgeBg: 'var(--color-derive-warning-bg)',
    badgeText_color: 'var(--color-derive-warning-text)',
    iconColor: '#833C00',
    cardBorderColor: 'var(--color-derive-warning-border)',
    cardBg: 'var(--color-derive-warning-bg)',
  },
}

// ============================================================
// formatRelativeDerive — date relative lisible
// ============================================================

function formatRelativeDerive(isoString: string): string {
  const now = new Date()
  const detected = new Date(isoString)
  const diffMs = now.getTime() - detected.getTime()
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  const diffJ = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffH < 1) return "Détecté à l'instant"
  if (diffH < 24) return `Détecté il y a ${diffH}h`
  if (diffJ < 7) return `Détecté il y a ${diffJ}j`
  return `Détecté le ${detected.toLocaleDateString('fr-FR')}`
}

// ============================================================
// Props
// ============================================================

interface AlertCardDeriveProps {
  derive: DeriveDetectee
}

// ============================================================
// Composant
// ============================================================

export function AlertCardDerive({ derive }: AlertCardDeriveProps) {
  const [expanded, setExpanded] = useState(false)
  const config = DERIVE_SEVERITE[derive.type] ?? DERIVE_SEVERITE.budget_depasse

  const message = derive.message_llm ?? ''
  const messageAffiche = expanded ? message : message.slice(0, 200)
  const peutExpander = message.length > 200

  return (
    <div
      data-testid={`alert-card-derive-${derive.id}`}
      className="rounded-md border-2 p-4 flex gap-3"
      style={{
        borderColor: config.cardBorderColor,
        backgroundColor: config.cardBg,
      }}
    >
      {/* Icône AlertOctagon colorée par sévérité (F004 BINDING) */}
      <div className="shrink-0 mt-0.5">
        <AlertOctagon
          size={20}
          aria-hidden
          style={{ color: config.iconColor }}
        />
      </div>

      <div className="flex-1 min-w-0">
        {/* Badge type (F004) */}
        <span
          className="inline-block text-[11px] font-bold px-2 py-0.5 rounded mb-2"
          style={{
            backgroundColor: config.badgeBg,
            color: config.badgeText_color,
            border: `1px solid ${config.cardBorderColor}`,
          }}
        >
          {config.badgeText}
        </span>

        {/* Message LLM/fallback — JSX pur, JAMAIS dangerouslySetInnerHTML (TST-K6-33) */}
        {message ? (
          <div>
            <p className="text-[13px] text-[var(--color-text-primary)] whitespace-pre-wrap">
              {/* TSX : React échappe automatiquement — pas de XSS possible */}
              {messageAffiche}
              {!expanded && peutExpander && '…'}
            </p>
            {peutExpander && (
              <button
                type="button"
                data-testid="btn-expand-message-derive"
                onClick={() => setExpanded((prev) => !prev)}
                className="mt-1 text-[12px] text-[var(--color-primary)] underline hover:no-underline"
              >
                {expanded ? 'Voir moins' : 'Voir plus'}
              </button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-muted)] italic">
            Aucun message disponible.
          </p>
        )}

        {/* Lien tâche si tache_id (F001 navigation) */}
        {derive.tache_id && (
          <Link
            href={`#tache-${derive.tache_id}`}
            data-testid={`link-tache-bloquee-${derive.tache_id}`}
            className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--color-primary)] underline hover:no-underline"
          >
            Voir la tâche
          </Link>
        )}

        {/* Date de détection relative */}
        <time
          className="mt-2 block text-[11px] text-[var(--color-text-muted)]"
          dateTime={derive.detected_at}
        >
          {formatRelativeDerive(derive.detected_at)}
        </time>
      </div>
    </div>
  )
}

export default AlertCardDerive
