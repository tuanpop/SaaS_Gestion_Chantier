// app/conducteur/briefings/[id]/page.tsx — Page détail briefing (conducteur)
// US-062 : conducteur accède au briefing de ses chantiers (rattaché)
// S7-03 note F002 : même contenu que admin/briefings/[id]/page.tsx, layout = bottom-nav mobile
// data-testid="page-briefing-detail" BINDING (Levi test plan)
// Auth : conducteur uniquement (middleware redirige ouvrier)
// TST-K7-22 : double filtre org + conductor access (canAccessChantier)
// V-7-15 BINDING : jamais dangerouslySetInnerHTML — JSX pur

import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Sun, Sparkles, CloudSun, AlertTriangle, AlertCircle, ArrowLeft, Calendar,
  CloudRain, Snowflake, Wind, Thermometer, CheckCircle2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessChantier } from '@/lib/chantier-access'
import { analyserMeteo } from '@/lib/briefing/analyserMeteo'
import type { MeteoJour } from '@/types/briefing'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

// ============================================================
// Helpers (identiques admin — copie isolée pour éviter import croisé layout)
// ============================================================

function formatDateBriefing(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateIso(isoDate: string): string {
  const [, m, d] = isoDate.split('-')
  return `${d}/${m}`
}

function MeteoIcon({ jour }: { jour: MeteoJour }) {
  if (jour.alerte_pluie) return <CloudRain className="w-5 h-5 text-[#1E40AF]" aria-hidden />
  if (jour.alerte_gel) return <Snowflake className="w-5 h-5 text-[#0369A1]" aria-hidden />
  if (jour.alerte_canicule) return <Thermometer className="w-5 h-5 text-[#92400E]" aria-hidden />
  if (jour.alerte_vent) return <Wind className="w-5 h-5 text-[#334155]" aria-hidden />
  return <Sun className="w-5 h-5 text-[#F97316]" aria-hidden />
}

function getMeteoJourBg(jour: MeteoJour): string {
  if (jour.alerte_pluie) return '#DBEAFE'
  if (jour.alerte_gel) return '#E0F2FE'
  if (jour.alerte_canicule) return '#FEF3C7'
  if (jour.alerte_vent) return '#F1F5F9'
  return '#fff'
}

function getMeteoJourBorder(jour: MeteoJour): string {
  if (jour.alerte_pluie) return '#3B82F6'
  if (jour.alerte_gel) return '#0369A1'
  if (jour.alerte_canicule) return '#92400E'
  if (jour.alerte_vent) return '#64748B'
  return '#000'
}

// ============================================================
// Page
// ============================================================

export default async function ConducteurBriefingDetailPage({ params }: PageProps) {
  const { id: briefingId } = await params

  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const userRole = user.app_metadata?.['role'] as string | undefined
  if (userRole !== 'conducteur') return notFound()

  const adminClient = createAdminClient()

  // Fetch briefing — filtre organisation_id OBLIGATOIRE (TST-K7-22)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefingRaw, error: briefingError } = await (adminClient as unknown as any)
    .from('briefings')
    .select('id, chantier_id, organisation_id, annee_iso, semaine_iso, contenu_genere, message_fallback, llm_utilise, meteo_disponible, code_postal, created_at, meteo_snapshot, chantiers!briefings_chantier_id_fkey(nom)')
    .eq('id', briefingId)
    .eq('organisation_id', organisationId)
    .single() as {
      data: {
        id: string
        chantier_id: string
        organisation_id: string
        annee_iso: number
        semaine_iso: number
        contenu_genere: string | null
        message_fallback: string | null
        llm_utilise: boolean
        meteo_disponible: boolean
        code_postal: string | null
        created_at: string
        meteo_snapshot: unknown
        chantiers: { nom: string } | null
      } | null
      error: { message: string; code?: string } | null
    }

  if (briefingError?.code === 'PGRST116' || !briefingRaw) return notFound()
  if (briefingError) return notFound()

  // Double vérif : conducteur doit être rattaché au chantier (TST-K7-22)
  const hasAccess = await canAccessChantier(
    adminClient,
    briefingRaw.chantier_id,
    organisationId,
    user.id,
    'conducteur',
  )
  if (!hasAccess) return notFound()  // 404 — ne révèle pas l'existence (I-06)

  // Extraire meteo_jours
  let meteoJours: MeteoJour[] | undefined = undefined
  if (briefingRaw.meteo_disponible && briefingRaw.meteo_snapshot !== null) {
    try {
      const meteoSemaine = analyserMeteo(
        briefingRaw.meteo_snapshot,
        briefingRaw.code_postal ?? 'inconnu',
        briefingRaw.created_at,
        'cache',
      )
      meteoJours = meteoSemaine.jours
    } catch {
      meteoJours = undefined
    }
  }

  const contenu = briefingRaw.contenu_genere ?? briefingRaw.message_fallback ?? ''
  const chantierNom = briefingRaw.chantiers?.nom ?? 'Chantier inconnu'
  const isFallback = !briefingRaw.llm_utilise

  const alertesMeteo = meteoJours?.flatMap((jour): Array<{ type: string; message: string; color: string; bg: string; border: string; icon: React.ReactNode }> => {
    const alertes = []
    if (jour.alerte_pluie) alertes.push({
      type: 'pluie',
      message: `${jour.jour_semaine} ${formatDateIso(jour.date_iso)} : pluie ${jour.precipitation_mm}mm — Reporter coulages béton`,
      color: '#1E40AF', bg: '#DBEAFE', border: '#1E40AF',
      icon: <CloudRain className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
    })
    if (jour.alerte_gel) alertes.push({
      type: 'gel',
      message: `${jour.jour_semaine} ${formatDateIso(jour.date_iso)} : gel ${jour.temp_min_c}°C — Précautions matériaux`,
      color: '#0369A1', bg: '#E0F2FE', border: '#0369A1',
      icon: <Snowflake className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
    })
    if (jour.alerte_canicule) alertes.push({
      type: 'canicule',
      message: `${jour.jour_semaine} ${formatDateIso(jour.date_iso)} : canicule ${jour.temp_max_c}°C — Obligations légales`,
      color: '#92400E', bg: '#FEF3C7', border: '#92400E',
      icon: <Thermometer className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
    })
    if (jour.alerte_vent) alertes.push({
      type: 'vent',
      message: `${jour.jour_semaine} ${formatDateIso(jour.date_iso)} : vent ${jour.vent_kmh.toFixed(0)} km/h — Travaux en hauteur à reporter`,
      color: '#334155', bg: '#F1F5F9', border: '#334155',
      icon: <Wind className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
    })
    return alertes
  }) ?? []

  return (
    <div data-testid="page-briefing-detail" className="pb-20">
      {/* En-tête contextuel conducteur (pattern bottom-nav conducteur — S7-04) */}
      <div className="bg-primary-dark px-4 py-4 mb-4">
        <Link
          href={`/conducteur/chantiers/${briefingRaw.chantier_id}#briefing`}
          className="text-white/70 text-xs flex items-center gap-1 mb-1"
          data-testid="btn-retour-liste-briefings"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
          Retour au chantier
        </Link>
        <h1 className="font-heading text-white text-lg font-bold">
          Briefing — {chantierNom}
        </h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-white/70 text-xs flex items-center gap-1">
            <Calendar className="w-3 h-3" aria-hidden />
            Semaine {briefingRaw.semaine_iso} — {briefingRaw.annee_iso}
          </span>
          {/* Badge LLM */}
          {briefingRaw.llm_utilise ? (
            <span
              data-testid="briefing-detail-badge-llm"
              className="badge badge-success text-xs flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" aria-hidden />
              Claude Sonnet
            </span>
          ) : (
            <span
              data-testid="briefing-detail-badge-llm"
              className="badge text-xs flex items-center gap-1"
              style={{
                background: 'var(--color-fallback-bg)',
                borderColor: 'var(--color-fallback-border)',
                color: 'var(--color-fallback-text)',
              }}
            >
              <AlertCircle className="w-3 h-3" aria-hidden />
              Sans IA
            </span>
          )}
          {/* Badge météo */}
          {briefingRaw.meteo_disponible ? (
            <span
              data-testid="briefing-detail-badge-meteo"
              className="badge text-xs flex items-center gap-1"
              style={{
                background: 'var(--color-briefing-bg)',
                borderColor: 'var(--color-briefing-border)',
                color: 'var(--color-briefing-text)',
              }}
            >
              <CloudSun className="w-3 h-3" aria-hidden />
              Météo
            </span>
          ) : (
            <span
              data-testid="briefing-detail-badge-meteo"
              className="badge text-xs flex items-center gap-1"
              style={{
                background: 'var(--color-meteo-ko-bg)',
                borderColor: 'var(--color-meteo-ko-border)',
                color: 'var(--color-meteo-ko-text)',
              }}
            >
              <AlertTriangle className="w-3 h-3" aria-hidden />
              Météo KO
            </span>
          )}
          <span
            data-testid="briefing-detail-semaine"
            className="sr-only"
          >
            Semaine {briefingRaw.semaine_iso} — {briefingRaw.annee_iso}
          </span>
          <span data-testid="briefing-detail-date" className="sr-only">
            {formatDateBriefing(briefingRaw.created_at)}
          </span>
          <span
            data-testid="briefing-detail-chantier-nom"
            className="sr-only"
          >
            {chantierNom}
          </span>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {/* Contenu du briefing — V-7-15 : JSX pur */}
        <div className="card-brutal p-5">
          <h2 className="font-heading text-[13px] font-bold text-primary uppercase tracking-widest border-b-2 border-primary pb-1.5 mb-3">
            Synthèse de la semaine
          </h2>
          {/* V-7-15 BINDING : whitespace-pre-line + JSX pur — React échappe automatiquement */}
          <div
            data-testid="briefing-detail-contenu"
            className="text-[14px] text-[#222222] leading-[1.7] whitespace-pre-line"
          >
            {contenu}
          </div>
        </div>

        {/* Bloc météo — visible terrain (icônes + badges compacts) */}
        {briefingRaw.meteo_disponible && meteoJours !== undefined ? (
          <div className="card-brutal p-5" data-testid="briefing-detail-meteo-bloc">
            <h2 className="font-heading text-[13px] font-bold text-primary uppercase tracking-widest border-b-2 border-primary pb-1.5 mb-3">
              Météo de la semaine
              {briefingRaw.code_postal && (
                <span className="font-normal text-muted normal-case tracking-normal text-xs ml-2">
                  CP {briefingRaw.code_postal}
                </span>
              )}
            </h2>

            {/* Grille 7 jours — scroll horizontal mobile */}
            <div className="overflow-x-auto">
              <div className="grid grid-cols-7 gap-1.5 min-w-[420px] mb-4">
                {meteoJours.map((jour) => (
                  <div
                    key={jour.date_iso}
                    data-testid={`briefing-detail-meteo-jour-${jour.date_iso}`}
                    className="border-2 rounded-md p-2 text-center"
                    style={{
                      background: getMeteoJourBg(jour),
                      borderColor: getMeteoJourBorder(jour),
                      boxShadow: '2px 2px 0 #000',
                    }}
                  >
                    <div className="text-[10px] font-bold text-[#555] mb-0.5">
                      {jour.jour_semaine.substring(0, 3)}
                    </div>
                    <div className="text-[10px] text-[#94A3B8] mb-1">
                      {formatDateIso(jour.date_iso)}
                    </div>
                    <div className="flex justify-center mb-1">
                      <MeteoIcon jour={jour} />
                    </div>
                    <div className="text-[11px] font-semibold text-[#1F4E79]">
                      {jour.temp_min_c.toFixed(0)}°/{jour.temp_max_c.toFixed(0)}°
                    </div>
                    {jour.precipitation_mm > 0 && (
                      <div className="text-[10px] text-[#1E40AF]">{jour.precipitation_mm.toFixed(0)}mm</div>
                    )}
                    <div className="mt-1 flex flex-col items-center gap-0.5">
                      {jour.alerte_pluie && (
                        <span
                          data-testid="briefing-detail-alerte-meteo-pluie"
                          className="text-[9px] font-bold px-1 py-0.5 rounded-sm"
                          style={{ background: '#DBEAFE', color: '#1E40AF', border: '1px solid #1E40AF' }}
                        >
                          PLUIE
                        </span>
                      )}
                      {jour.alerte_gel && (
                        <span
                          data-testid="briefing-detail-alerte-meteo-gel"
                          className="text-[9px] font-bold px-1 py-0.5 rounded-sm"
                          style={{ background: '#E0F2FE', color: '#0369A1', border: '1px solid #0369A1' }}
                        >
                          GEL
                        </span>
                      )}
                      {jour.alerte_canicule && (
                        <span
                          data-testid="briefing-detail-alerte-meteo-canicule"
                          className="text-[9px] font-bold px-1 py-0.5 rounded-sm"
                          style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #92400E' }}
                        >
                          CANI
                        </span>
                      )}
                      {jour.alerte_vent && (
                        <span
                          data-testid="briefing-detail-alerte-meteo-vent"
                          className="text-[9px] font-bold px-1 py-0.5 rounded-sm"
                          style={{ background: '#F1F5F9', color: '#334155', border: '1px solid #64748B' }}
                        >
                          VENT
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Alertes terrain */}
            {alertesMeteo.length > 0 ? (
              <div className="space-y-1.5">
                {alertesMeteo.map((alerte, i) => (
                  <div
                    key={`${alerte.type}-${i}`}
                    className="flex items-center gap-2 text-[13px] px-3 py-2 rounded-md"
                    style={{ background: alerte.bg, color: alerte.color, border: `1px solid ${alerte.border}` }}
                  >
                    {alerte.icon}
                    <span>{alerte.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                Conditions météo favorables cette semaine.
              </div>
            )}
          </div>
        ) : !briefingRaw.meteo_disponible ? (
          <div
            className="card-brutal p-4 flex items-start gap-3"
            data-testid="briefing-detail-meteo-indisponible"
            style={{ borderLeft: '4px solid var(--color-meteo-ko-border)' }}
          >
            <AlertTriangle
              className="w-5 h-5 flex-shrink-0 mt-0.5"
              style={{ color: 'var(--color-meteo-ko-text)' }}
              aria-hidden
            />
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--color-meteo-ko-text)' }}>
                Météo indisponible
              </p>
              <p className="text-[13px] text-muted mt-1">
                Données météo non disponibles ce matin. Consultez Météo France pour votre planning.
              </p>
            </div>
          </div>
        ) : null}

        {/* Fallback sans IA — bandeau informatif */}
        {isFallback && (
          <div
            className="card-brutal p-4 flex items-start gap-3"
            style={{ borderLeft: `4px solid var(--color-fallback-border)` }}
          >
            <AlertCircle
              className="w-5 h-5 flex-shrink-0 mt-0.5"
              style={{ color: 'var(--color-fallback-text)' }}
              aria-hidden
            />
            <p className="text-[13px]" style={{ color: 'var(--color-fallback-text)' }}>
              Ce briefing a été généré sans IA (service temporairement indisponible). Le contenu est un résumé automatique.
            </p>
          </div>
        )}
      </div>

      {/* Bottom nav conducteur (identique pattern page chantier) */}
      <nav className="bottom-nav" aria-label="Navigation conducteur">
        <Link href="/conducteur/chantiers" className="active">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Chantiers</span>
        </Link>
        <Link href="/conducteur/cr">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>CR</span>
        </Link>
      </nav>
    </div>
  )
}
