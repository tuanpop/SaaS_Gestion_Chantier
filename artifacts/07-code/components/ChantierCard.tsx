// components/ChantierCard.tsx
// Carte portefeuille chantier avec pastille coloration
// Réutilisée sur : app/(admin)/chantiers/page.tsx + app/(conducteur)/chantiers/page.tsx
//
// Proto référencé :
//   Admin desktop : mockups/15-admin-dashboard.html lignes 266-367
//   Conducteur mobile : mockups/08-conducteur-chantiers.html lignes 108-177
//
// Design system Hana :
//   - Pastille ronde w-3 h-3 rounded-full bg-[couleur] border-2 border-black
//   - card-brutal + border-l-[4px] border-l-[couleur-statut]
//   - Pas de box-shadow avec blur (interdiction absolue §1 Neubrutalism)
//   - Active state : translate(2px, 2px) + shadow réduite

import Link from 'next/link'
import type { Chantier, CouleurChantier } from '@/types/database'

// ============================================================
// Types
// ============================================================

interface ChantierCardProps {
  chantier: Chantier & { couleur: CouleurChantier }
  href: string    // lien vers le détail
  variant?: 'desktop' | 'mobile'
  tachesCount?: number
  tachesTermineesCount?: number // T16 — format "X/Y tâches" (terminées/total) — proto 15-admin-dashboard.html l.278
  ouvriersCount?: number
}

// ============================================================
// Helpers
// ============================================================

const COULEUR_STYLES: Record<CouleurChantier, {
  borderLeft: string
  pastille: string
  badgeClass: string
  badgeLabel: string
  progressBg: string
}> = {
  rouge: {
    borderLeft: 'border-l-[4px] border-l-danger',
    pastille: 'bg-danger',
    badgeClass: 'badge badge-danger',
    badgeLabel: 'En retard',
    progressBg: 'bg-danger',
  },
  orange: {
    borderLeft: 'border-l-[4px] border-l-warning',
    pastille: 'bg-warning',
    badgeClass: 'badge badge-warning',
    badgeLabel: 'Dérive',
    progressBg: 'bg-warning',
  },
  vert: {
    borderLeft: 'border-l-[4px] border-l-success',
    pastille: 'bg-success',
    badgeClass: 'badge badge-success',
    badgeLabel: 'OK',
    progressBg: 'bg-success',
  },
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

function formatMontant(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(amount) + '€'
}

function getBudgetProgress(depense: number, alloue: number | null): number {
  if (!alloue || alloue === 0) return 0
  return Math.min(Math.round((depense / alloue) * 100), 100)
}

function getJoursRestants(dateFin: string): number {
  const fin = new Date(dateFin)
  const aujourdhui = new Date()
  aujourdhui.setHours(0, 0, 0, 0)
  fin.setHours(0, 0, 0, 0)
  const ms = fin.getTime() - aujourdhui.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

// ============================================================
// ChantierCard — Desktop Admin
// ============================================================

function ChantierCardDesktop({ chantier, href, tachesCount = 0, tachesTermineesCount, ouvriersCount = 0 }: ChantierCardProps) {
  const isArchive = chantier.statut === 'archive'
  // Si archivé : neutralise la pastille couleur (gris) — le statut métier n'a plus de sens.
  const styles = isArchive
    ? {
        borderLeft: 'border-l-[4px] border-l-[#999]',
        pastille: 'bg-[#999]',
        badgeClass: 'badge badge-muted',
        badgeLabel: 'Archivé',
        progressBg: 'bg-[#999]',
      }
    : COULEUR_STYLES[chantier.couleur]
  const progress = getBudgetProgress(chantier.budget_depense, chantier.budget_alloue)
  const joursRestants = getJoursRestants(chantier.date_fin_prevue)
  const estDepasse = chantier.budget_alloue !== null && chantier.budget_depense > chantier.budget_alloue

  return (
    <Link
      href={href}
      className={`card-brutal p-5 block hover:shadow-brutal-hover transition-shadow ${styles.borderLeft} ${isArchive ? 'opacity-70' : ''}`}
    >
      {/* Header : nom + pastille */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-heading font-semibold text-[17px] text-[#222222]">
          {chantier.nom}
        </h3>
        <span
          className={`w-3 h-3 rounded-full border-2 border-black ${styles.pastille}`}
          aria-label={`Statut : ${styles.badgeLabel}`}
        />
      </div>

      {/* Client */}
      <p className="text-muted text-sm mb-3">
        Client : {chantier.client_nom}
      </p>

      {/* Budget progress bar */}
      {chantier.budget_alloue !== null ? (
        <>
          <div className="progress-bar mb-2">
            <div
              className={`progress-fill ${styles.progressBg}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-sm mb-3">
            <span className="font-semibold">
              {formatMontant(chantier.budget_depense)} / {formatMontant(chantier.budget_alloue)}
            </span>
            {estDepasse ? (
              <span className="text-danger font-bold">
                +{formatMontant(chantier.budget_depense - chantier.budget_alloue)}
              </span>
            ) : (
              <span className="text-success font-bold">
                -{formatMontant(chantier.budget_alloue - chantier.budget_depense)}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="mb-3 text-xs text-muted">Budget non défini</div>
      )}

      {/* Footer : tâches + ouvriers + badge statut + date fin */}
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted">
          {/* T16 — "X/Y tâches" si tachesTermineesCount défini et tâches > 0, sinon "X tâches" */}
          {tachesTermineesCount !== undefined && tachesCount > 0
            ? `${tachesTermineesCount}/${tachesCount} tâches`
            : `${tachesCount} tâche${tachesCount !== 1 ? 's' : ''}`}
          {' '}&bull; {ouvriersCount} ouvrier{ouvriersCount !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          {!isArchive && joursRestants >= 0 && joursRestants <= 3 && (
            <span className="text-xs text-warning font-semibold">
              J-{joursRestants}
            </span>
          )}
          <span
            className={styles.badgeClass + ' text-xs'}
            data-testid={isArchive ? 'chantier-status-archive' : `chantier-status-${chantier.couleur}`}
          >
            {styles.badgeLabel}
          </span>
        </div>
      </div>
    </Link>
  )
}

// ============================================================
// ChantierCard — Mobile Conducteur
// ============================================================

function ChantierCardMobile({ chantier, href, tachesCount = 0, ouvriersCount = 0 }: ChantierCardProps) {
  const styles = COULEUR_STYLES[chantier.couleur]
  const progress = getBudgetProgress(chantier.budget_depense, chantier.budget_alloue)
  const joursRestants = getJoursRestants(chantier.date_fin_prevue)

  return (
    <Link
      href={href}
      className={`card-brutal-mobile block p-3 ${styles.borderLeft}`}
    >
      {/* Header : nom + badge statut */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="font-heading font-semibold text-[15px] text-[#222222]">
            {chantier.nom}
          </div>
          <div className="text-muted text-xs">
            Client : {chantier.client_nom}
          </div>
        </div>
        <span
          className={`${styles.badgeClass} ml-2 shrink-0 text-xs`}
          data-testid={`chantier-status-${chantier.couleur}`}
        >
          {styles.badgeLabel}
        </span>
      </div>

      {/* Progress bar budget (mobile : h-2) */}
      {chantier.budget_alloue !== null ? (
        <div className="progress-bar-mobile mt-2 overflow-hidden">
          <div
            className={`progress-fill ${styles.progressBg}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : (
        <div className="mt-2 h-2 bg-surface border border-black rounded overflow-hidden" />
      )}

      {/* Footer : tâches + ouvriers + J-X si proche */}
      <div className="flex items-center gap-3 mt-2 text-xs text-muted">
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          {tachesCount} tâches
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
          {ouvriersCount} ouvriers
        </span>
        {joursRestants >= 0 && joursRestants <= 3 && (
          <span className="text-warning font-semibold ml-auto">J-{joursRestants}</span>
        )}
        <span className="text-xs ml-auto">Fin {formatDate(chantier.date_fin_prevue)}</span>
      </div>
    </Link>
  )
}

// ============================================================
// Export principal — détecte le variant
// ============================================================

export function ChantierCard(props: ChantierCardProps) {
  if (props.variant === 'mobile') {
    return <ChantierCardMobile {...props} />
  }
  return <ChantierCardDesktop {...props} />
}
