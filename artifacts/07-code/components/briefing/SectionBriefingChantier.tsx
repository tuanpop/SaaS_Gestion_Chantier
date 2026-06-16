'use client'
// components/briefing/SectionBriefingChantier.tsx — Section "Briefing de la semaine"
// V-7-14 BINDING : visible sans clic supplémentaire dans la page chantier
// S7-04 : 4 états (A: briefing disponible, B: météo KO, C: fallback sans IA, D: état vide)
// data-testid="section-briefing-chantier" BINDING (Levi test plan)
// D-7-15 BINDING : distinction visuelle bleu (briefing prospectif) vs vert (rapport rétrospectif)
// V-7-15 BINDING : jamais dangerouslySetInnerHTML — JSX pur
//
// Admin : rôle admin — href vers /admin/briefings/[id]
// Conducteur : rôle conducteur — href vers /conducteur/briefings/[id]

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sun, Sparkles, CloudSun, AlertTriangle, AlertCircle, ArrowRight } from 'lucide-react'
import type { BriefingPublic } from '@/types/briefing'

// ============================================================
// Helpers
// ============================================================

/** Formate une date ISO en label "Semaine N — Lundi D mois YYYY" */
function formatSemaineLabel(anneeIso: number, semaineIso: number, createdAt: string): string {
  const date = new Date(createdAt)
  const dateLabel = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  // Capitalize first letter
  const dateCapitalized = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)
  return `Semaine ${semaineIso} — ${dateCapitalized}`
}

/** Calcule le prochain lundi à partir d'aujourd'hui */
function getProchainLundi(): string {
  const now = new Date()
  const day = now.getDay() // 0=dimanche, 1=lundi, ...
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7
  const nextMonday = new Date(now)
  nextMonday.setDate(now.getDate() + daysUntilMonday)
  return nextMonday.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ============================================================
// Props
// ============================================================

interface SectionBriefingChantierProps {
  chantierId: string
  role?: 'admin' | 'conducteur'
}

// ============================================================
// Skeleton
// ============================================================

function BriefingSkeleton() {
  return (
    <section
      id="briefing"
      data-testid="briefing-chantier-skeleton"
      aria-busy="true"
      aria-label="Chargement du briefing"
      className="mb-6"
    >
      <div className="card-brutal p-0 overflow-hidden">
        <div
          className="border-b-2 border-[#94A3B8] bg-[var(--color-surface)] p-4 flex items-center gap-3"
        >
          <div className="skeleton w-6 h-6 rounded flex-shrink-0" />
          <div className="skeleton h-4 w-44 rounded" />
          <div className="ml-auto flex gap-2">
            <div className="skeleton h-6 w-28 rounded" />
            <div className="skeleton h-6 w-24 rounded" />
          </div>
        </div>
        <div className="p-5">
          <div className="skeleton h-3.5 w-full rounded mb-2" />
          <div className="skeleton h-3.5 w-[90%] rounded mb-2" />
          <div className="skeleton h-3.5 w-[80%] rounded mb-2" />
          <div className="skeleton h-3.5 w-[70%] rounded" />
        </div>
        <div className="p-4 bg-[var(--color-surface)] flex justify-end">
          <div className="skeleton h-9 w-44 rounded" />
        </div>
      </div>
    </section>
  )
}

// ============================================================
// Composant principal
// ============================================================

export function SectionBriefingChantier({
  chantierId,
  role = 'admin',
}: SectionBriefingChantierProps) {
  const [briefing, setBriefing] = useState<BriefingPublic | null | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchBriefing() {
      try {
        const res = await fetch(
          `/api/chantiers/${chantierId}/briefings?limit=1`,
          { cache: 'no-store' },
        )
        if (!res.ok) {
          if (!cancelled) setBriefing(null)
          return
        }
        const json = await res.json() as { briefings: BriefingPublic[]; next_cursor: string | null }
        if (!cancelled) {
          setBriefing(json.briefings?.[0] ?? null)
        }
      } catch {
        if (!cancelled) setBriefing(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchBriefing()
    return () => { cancelled = true }
  }, [chantierId])

  if (isLoading) {
    return <BriefingSkeleton />
  }

  // ── État D : Aucun briefing disponible ───────────────────────────────────
  if (briefing === null) {
    const prochainLundi = getProchainLundi()
    return (
      <section
        id="briefing"
        data-testid="section-briefing-chantier"
        aria-label="Briefing de la semaine"
        className="mb-6"
      >
        <div className="card-brutal p-0 overflow-hidden border-[#94A3B8]">
          <div className="bg-[var(--color-surface)] border-b-2 border-[#94A3B8] p-4 flex items-center gap-3">
            <Sun className="w-6 h-6 text-[#94A3B8] flex-shrink-0" aria-hidden />
            <span className="font-heading font-bold text-base text-[#555555]">
              Briefing de la semaine
            </span>
          </div>
          <div
            data-testid="briefing-chantier-empty-state"
            className="p-8 text-center"
          >
            <Sun className="w-9 h-9 text-[#94A3B8] mx-auto mb-3" aria-hidden />
            <p className="text-sm font-semibold text-[#555555] mb-1.5">
              Aucun briefing disponible pour ce chantier.
            </p>
            <p
              data-testid="briefing-chantier-next-monday"
              className="text-[13px] text-[#94A3B8]"
            >
              Le prochain briefing sera généré automatiquement le{' '}
              <strong className="text-[var(--color-briefing-text)]">{prochainLundi} à 08h30</strong>.
            </p>
          </div>
        </div>
      </section>
    )
  }

  // ── État A / B / C : Briefing disponible ─────────────────────────────────
  // narrowing : après le guard null et isLoading=false, briefing est BriefingPublic
  if (!briefing) return null

  const semaineLabel = formatSemaineLabel(briefing.annee_iso, briefing.semaine_iso, briefing.created_at)

  // Couleur selon état : C (fallback) = violet, A/B = bleu
  const isFallback = !briefing.llm_utilise
  const headerBg = isFallback ? 'bg-[var(--color-fallback-bg)]' : 'bg-[var(--color-briefing-bg)]'
  const headerBorder = isFallback ? 'border-[var(--color-fallback-border)]' : 'border-[var(--color-briefing-border)]'
  const titleColor = isFallback ? 'text-[var(--color-fallback-text)]' : 'text-[var(--color-briefing-text)]'
  const sunColor = isFallback ? 'text-[var(--color-fallback-border)]' : 'text-[var(--color-briefing-icon)]'
  const cardBorderColor = isFallback ? 'border-[var(--color-fallback-border)]' : 'border-[var(--color-briefing-border)]'
  const cardShadowColor = isFallback ? '[box-shadow:4px_4px_0_var(--color-fallback-border)]' : '[box-shadow:4px_4px_0_var(--color-briefing-border)]'

  // Contenu à afficher — contenu_genere prioritaire, sinon message_fallback
  const contenu = briefing.contenu_genere ?? briefing.message_fallback ?? ''

  // href vers la page détail selon rôle
  const briefingDetailHref = `/${role}/briefings/${briefing.id}`

  return (
    <section
      id="briefing"
      data-testid="section-briefing-chantier"
      aria-label="Briefing de la semaine"
      className="mb-6"
    >
      <div
        className={`card-brutal p-0 overflow-hidden ${cardBorderColor} ${cardShadowColor}`}
        style={{ border: '2px solid', boxShadow: `4px 4px 0 ${isFallback ? 'var(--color-fallback-border)' : 'var(--color-briefing-border)'}` }}
      >
        {/* En-tête */}
        <div
          className={`${headerBg} ${headerBorder} border-b-2 p-4 flex items-center justify-between gap-3 flex-wrap`}
        >
          <div className="flex items-center gap-2.5">
            <Sun className={`w-[22px] h-[22px] ${sunColor} flex-shrink-0`} aria-hidden />
            <div>
              <div className={`font-heading font-bold text-base ${titleColor}`}>
                Briefing de la semaine
              </div>
              <div
                data-testid="briefing-chantier-semaine-label"
                className={`text-xs mt-0.5 ${titleColor}`}
              >
                {semaineLabel}
              </div>
            </div>
          </div>

          {/* Badges état */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Badge LLM */}
            {briefing.llm_utilise ? (
              <span
                data-testid="briefing-chantier-badge-llm"
                className="badge badge-success text-xs flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" aria-hidden />
                Claude Sonnet
              </span>
            ) : (
              <span
                data-testid="briefing-chantier-badge-llm"
                className="badge text-xs flex items-center gap-1"
                style={{
                  background: 'var(--color-fallback-bg)',
                  borderColor: 'var(--color-fallback-border)',
                  color: 'var(--color-fallback-text)',
                }}
              >
                <AlertCircle className="w-3 h-3" aria-hidden />
                Généré sans IA
              </span>
            )}

            {/* Badge météo */}
            {briefing.meteo_disponible ? (
              <span
                data-testid="briefing-chantier-badge-meteo"
                className="badge text-xs flex items-center gap-1"
                style={{
                  background: 'var(--color-briefing-bg)',
                  borderColor: 'var(--color-briefing-border)',
                  color: 'var(--color-briefing-text)',
                }}
              >
                <CloudSun className="w-3 h-3" aria-hidden />
                Météo disponible
              </span>
            ) : (
              <span
                data-testid="briefing-chantier-badge-meteo"
                className="badge text-xs flex items-center gap-1"
                style={{
                  background: 'var(--color-meteo-ko-bg)',
                  borderColor: 'var(--color-meteo-ko-border)',
                  color: 'var(--color-meteo-ko-text)',
                }}
              >
                <AlertTriangle className="w-3 h-3" aria-hidden />
                Météo indisponible
              </span>
            )}

            {/* Badge prospectif (distinction D-7-15 BINDING) */}
            <span
              data-testid="badge-briefing-prospectif"
              className="badge text-[11px] opacity-80"
              style={{
                background: 'var(--color-briefing-bg)',
                borderColor: 'var(--color-briefing-border)',
                color: 'var(--color-briefing-text)',
              }}
            >
              Prospectif
            </span>
          </div>
        </div>

        {/* Contenu preview — V-7-15 BINDING : JSX pur, JAMAIS dangerouslySetInnerHTML */}
        <div
          data-testid="briefing-chantier-content-preview"
          className="p-5 border-b-2 border-[#E2E8F0]"
        >
          {/* V-7-15 : texte brut en JSX — React échappe automatiquement */}
          <p
            className="text-[14px] text-[#374151] leading-[1.7] line-clamp-5 m-0"
          >
            {contenu}
          </p>
        </div>

        {/* Footer actions */}
        <div
          className="p-3.5 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: '#F8FBFF' }}
        >
          {/* Avertissement météo KO */}
          {!briefing.meteo_disponible && (
            <div
              className="flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--color-meteo-ko-text)' }}
            >
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
              Météo indisponible — voir Météo France pour votre planning
            </div>
          )}

          {/* Bouton "Voir le briefing complet" — BINDING (data-testid) */}
          <Link
            href={briefingDetailHref}
            className="btn-brutal ml-auto text-sm py-2 px-4"
            data-testid="btn-voir-briefing-complet"
            aria-label={`Voir le briefing complet de la semaine ${briefing.semaine_iso}`}
            style={{
              background: 'var(--color-briefing-bg)',
              color: 'var(--color-briefing-text)',
              borderColor: 'var(--color-briefing-border)',
            }}
          >
            Voir le briefing complet
            <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  )
}

export default SectionBriefingChantier
