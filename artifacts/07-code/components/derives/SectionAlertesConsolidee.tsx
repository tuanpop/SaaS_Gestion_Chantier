'use client'
// components/derives/SectionAlertesConsolidee.tsx — Section alertes dashboard admin
// US-051 (vue consolidée admin)
//
// data-testid exacts (specs §10.5 / design-notes §6) :
//   "section-alertes-dashboard"
//   "alertes-dashboard-total-count"
//   "alertes-dashboard-empty-state"
//   "derive-row-chantier-[chantier_id]"
//
// Composant Client : fetche depuis le navigateur.
// Admin uniquement (routing middleware + 403 API garantissent l'isolation).
// Sécurité : TST-K6-14 (filtre org handler-level côté API — cf. GET /api/derives).

import { useEffect, useState } from 'react'
import { AlertOctagon } from 'lucide-react'
import Link from 'next/link'
import type { DeriveConsolidee, DerivesConsolideeResponse, DeriveType } from '@/types/detection'

// ============================================================
// Helpers
// ============================================================

function typeLabel(type: DeriveType): string {
  switch (type) {
    case 'budget_depasse': return 'Budget dépassé'
    case 'retard_date_fin': return 'Retard'
    case 'tache_bloquee_longue': return 'Tâche bloquée'
    case 'inactivite_chantier': return 'Inactivité'
  }
}

function typeSeverite(type: DeriveType): 'critique' | 'warning' {
  return type === 'inactivite_chantier' ? 'warning' : 'critique'
}

// Skeleton
function SkeletonConsolidee() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-md border-2 border-[var(--color-derive-critique-border)] bg-[var(--color-derive-critique-bg)] p-3 animate-pulse"
          style={{ height: 56 }}
        />
      ))}
    </div>
  )
}

// ============================================================
// Composant
// ============================================================

export function SectionAlertesConsolidee() {
  const [derives, setDerives] = useState<DeriveConsolidee[]>([])
  const [totalActives, setTotalActives] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchDerives() {
      setLoading(true)
      setErreur(null)
      try {
        const res = await fetch('/api/derives?limit=20')
        if (!res.ok) {
          throw new Error(`Erreur ${res.status}`)
        }
        const data: DerivesConsolideeResponse = await res.json()
        if (!cancelled) {
          setDerives(data.derives)
          setTotalActives(data.total_actives)
        }
      } catch (_err) {
        if (!cancelled) {
          setErreur('Impossible de charger les alertes.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchDerives()
    return () => { cancelled = true }
  }, [])

  return (
    <section
      data-testid="section-alertes-dashboard"
      className="mb-6"
      aria-labelledby="alertes-dashboard-titre"
    >
      {/* En-tête */}
      <div className="flex items-center gap-2 mb-3">
        <AlertOctagon size={18} style={{ color: 'var(--color-alerte-rouge)' }} aria-hidden />
        <h2
          id="alertes-dashboard-titre"
          className="font-heading font-bold text-[16px] text-[var(--color-text-primary)]"
        >
          Alertes en cours
        </h2>
        {!loading && !erreur && (
          <span
            data-testid="alertes-dashboard-total-count"
            className="ml-1 inline-flex items-center justify-center rounded-full text-[11px] font-bold px-2 py-0.5"
            style={{
              backgroundColor: totalActives > 0
                ? 'var(--color-alerte-rouge)'
                : 'var(--color-sain-bg)',
              color: totalActives > 0 ? '#fff' : 'var(--color-sain-text)',
            }}
          >
            {totalActives}
          </span>
        )}
      </div>

      {/* États */}
      {loading && <SkeletonConsolidee />}

      {!loading && erreur && (
        <p className="text-[13px] text-[var(--color-danger)]" role="alert">
          {erreur}
        </p>
      )}

      {!loading && !erreur && derives.length === 0 && (
        <div
          data-testid="alertes-dashboard-empty-state"
          className="flex items-center gap-2 rounded-md border-2 p-3"
          style={{
            borderColor: 'var(--color-sain-border)',
            backgroundColor: 'var(--color-sain-bg)',
          }}
        >
          <span
            className="text-[13px] font-medium"
            style={{ color: 'var(--color-sain-text)' }}
          >
            Aucune alerte active sur vos chantiers.
          </span>
        </div>
      )}

      {!loading && !erreur && derives.length > 0 && (
        <div className="space-y-2">
          {derives.map((derive) => {
            const severite = typeSeverite(derive.type)
            return (
              <Link
                key={derive.id}
                href={`/admin/chantiers/${derive.chantier_id}`}
                data-testid={`derive-row-chantier-${derive.chantier_id}`}
                className="flex items-center gap-3 rounded-md border-2 px-3 py-2 transition-colors hover:opacity-90"
                style={{
                  borderColor: severite === 'critique'
                    ? 'var(--color-derive-critique-border)'
                    : 'var(--color-derive-warning-border)',
                  backgroundColor: severite === 'critique'
                    ? 'var(--color-derive-critique-bg)'
                    : 'var(--color-derive-warning-bg)',
                }}
              >
                <AlertOctagon
                  size={16}
                  aria-hidden
                  style={{
                    color: severite === 'critique'
                      ? 'var(--color-alerte-rouge)'
                      : '#833C00',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                    {/* JSX pur — React échappe automatiquement (TST-K6-33) */}
                    {derive.chantier_nom}
                  </p>
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    {typeLabel(derive.type)}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
                  {new Date(derive.detected_at).toLocaleDateString('fr-FR')}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default SectionAlertesConsolidee
