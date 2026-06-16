'use client'
// components/derives/SectionAlertesChantier.tsx — Section "Alertes actives" page chantier
// US-049 (section alertes chantier admin + conducteur)
//
// F001 BINDING : section visible sans clic (avant les onglets).
//   Ancre id="alertes" — accessible depuis `/[role]/chantiers/[id]#alertes`.
// data-testid exacts (specs §10.5 / design-notes §6) :
//   "section-alertes-chantier"
//   "alertes-chantier-badge-count"
//   "alertes-chantier-empty-state"
//
// Composant Client : fetche depuis le navigateur pour éviter les données stales.
// Sécurité : affiché uniquement pour admin+conducteur (routing middleware en amont).

import { useEffect, useState } from 'react'
import { AlertOctagon } from 'lucide-react'
import { AlertCardDerive } from '@/components/derives/AlertCardDerive'
import type { DeriveDetectee, DerivesChantierResponse } from '@/types/detection'

// ============================================================
// Props
// ============================================================

interface SectionAlertesChantierProps {
  chantierId: string
}

// ============================================================
// Skeleton
// ============================================================

function SkeletonAlertes() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Chargement des alertes">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="rounded-md border-2 border-[var(--color-derive-critique-border)] bg-[var(--color-derive-critique-bg)] p-4 animate-pulse"
          style={{ height: 80 }}
        />
      ))}
    </div>
  )
}

// ============================================================
// Composant
// ============================================================

export function SectionAlertesChantier({ chantierId }: SectionAlertesChantierProps) {
  const [derives, setDerives] = useState<DeriveDetectee[]>([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchDerives() {
      setLoading(true)
      setErreur(null)
      try {
        const res = await fetch(`/api/chantiers/${chantierId}/derives?actif=true&limit=20`)
        if (!res.ok) {
          throw new Error(`Erreur ${res.status}`)
        }
        const data: DerivesChantierResponse = await res.json()
        if (!cancelled) {
          setDerives(data.derives)
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
  }, [chantierId])

  return (
    // F001 BINDING : ancre id="alertes" — accessible depuis #alertes
    <section
      id="alertes"
      data-testid="section-alertes-chantier"
      className="mb-6"
      aria-labelledby="alertes-titre"
    >
      {/* En-tête section */}
      <div className="flex items-center gap-2 mb-3">
        <AlertOctagon size={18} style={{ color: 'var(--color-alerte-rouge)' }} aria-hidden />
        <h2
          id="alertes-titre"
          className="font-heading font-bold text-[16px] text-[var(--color-text-primary)]"
        >
          Alertes actives
        </h2>
        {!loading && !erreur && (
          <span
            data-testid="alertes-chantier-badge-count"
            className="ml-1 inline-flex items-center justify-center rounded-full text-[11px] font-bold px-2 py-0.5"
            style={{
              backgroundColor: derives.length > 0
                ? 'var(--color-alerte-rouge)'
                : 'var(--color-sain-bg)',
              color: derives.length > 0 ? '#fff' : 'var(--color-sain-text)',
            }}
          >
            {derives.length}
          </span>
        )}
      </div>

      {/* États */}
      {loading && <SkeletonAlertes />}

      {!loading && erreur && (
        <p className="text-[13px] text-[var(--color-danger)]" role="alert">
          {erreur}
        </p>
      )}

      {!loading && !erreur && derives.length === 0 && (
        <div
          data-testid="alertes-chantier-empty-state"
          className="flex items-center gap-2 rounded-md border-2 p-3"
          style={{
            borderColor: 'var(--color-sain-border)',
            backgroundColor: 'var(--color-sain-bg)',
          }}
        >
          <span
            className="inline-flex items-center justify-center rounded-full text-[12px] font-bold px-2 py-0.5"
            style={{
              backgroundColor: 'var(--color-sain-bg)',
              color: 'var(--color-sain-text)',
              border: '1px solid var(--color-sain-border)',
            }}
          >
            Aucune alerte active
          </span>
        </div>
      )}

      {!loading && !erreur && derives.length > 0 && (
        <div className="space-y-3">
          {derives.map((derive) => (
            <AlertCardDerive key={derive.id} derive={derive} />
          ))}
        </div>
      )}
    </section>
  )
}

export default SectionAlertesChantier
