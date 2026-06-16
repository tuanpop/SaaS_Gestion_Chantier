// app/admin/briefings/[id]/page.tsx — Page détail briefing (admin)
// US-062 : consulter le contenu complet + bloc météo 7 jours (PO Option A)
// data-testid="page-briefing-detail" BINDING (Levi test plan)
// S7-03 : header chantier + badges état + contenu complet + bloc météo + jalons + dérives
// Auth : admin (middleware) — Server Component fetch via adminClient
// D-7-09 : briefing immuable — pas de bouton Edit ni Delete
// V-7-15 BINDING : jamais dangerouslySetInnerHTML — JSX pur
// meteo_jours extraits de meteo_snapshot côté serveur (PO Option A)
// Exclut : donnees_brutes, meteo_snapshot (brut), notification_ids, organisation_id

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
// Helpers affichage
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
  const [_y, m, d] = isoDate.split('-')
  return `${d}/${m}`
}

/** Icône météo selon alertes actives */
function MeteoIcon({ jour }: { jour: MeteoJour }) {
  if (jour.alerte_pluie) return <CloudRain className="w-5 h-5 text-[#1E40AF]" aria-hidden />
  if (jour.alerte_gel) return <Snowflake className="w-5 h-5 text-[#0369A1]" aria-hidden />
  if (jour.alerte_canicule) return <Thermometer className="w-5 h-5 text-[#92400E]" aria-hidden />
  if (jour.alerte_vent) return <Wind className="w-5 h-5 text-[#334155]" aria-hidden />
  return <Sun className="w-5 h-5 text-[#F97316]" aria-hidden />
}

/** Couleur de fond de la colonne météo selon alerte */
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

export default async function AdminBriefingDetailPage({ params }: PageProps) {
  const { id: briefingId } = await params

  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const userRole = user.app_metadata?.['role'] as string | undefined
  if (userRole !== 'admin') return notFound()

  const adminClient = createAdminClient()

  // Fetch briefing — filtre organisation_id OBLIGATOIRE (TST-K7-22)
  // meteo_snapshot sélectionné UNIQUEMENT pour extraction serveur → non transmis au client
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

  // Vérification accès chantier (admin → toujours OK dans leur org, mais double défense)
  const hasAccess = await canAccessChantier(
    adminClient,
    briefingRaw.chantier_id,
    organisationId,
    user.id,
    'admin',
  )
  if (!hasAccess) return notFound()

  // Extraire meteo_jours depuis meteo_snapshot (PO Option A)
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

  // Contenu à afficher
  const contenu = briefingRaw.contenu_genere ?? briefingRaw.message_fallback ?? ''
  const chantierNom = briefingRaw.chantiers?.nom ?? 'Chantier inconnu'
  const isFallback = !briefingRaw.llm_utilise

  // Alertes BTP aggrégées depuis meteo_jours
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
      message: `${jour.jour_semaine} ${formatDateIso(jour.date_iso)} : vent fort ${jour.vent_kmh.toFixed(0)} km/h — Travaux en hauteur à reporter`,
      color: '#334155', bg: '#F1F5F9', border: '#334155',
      icon: <Wind className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />,
    })
    return alertes
  }) ?? []

  return (
    <div data-testid="page-briefing-detail">
      {/* Navigation retour */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Link
          href="/admin/briefings"
          className="btn-brutal py-2 px-3.5 text-[13px] bg-white"
          data-testid="btn-retour-liste-briefings"
          aria-label="Retour à la liste des briefings"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
          Retour aux briefings
        </Link>
        <nav aria-label="Fil d'Ariane" className="text-[13px] text-[#94A3B8] flex items-center gap-1.5">
          <span>Briefings</span>
          <span aria-hidden>›</span>
          <span className="text-primary font-semibold">
            {chantierNom} — Semaine {briefingRaw.semaine_iso}
          </span>
        </nav>
      </div>

      {/* En-tête briefing */}
      <div className="flex items-start gap-4 mb-6 flex-wrap">
        <div
          className="w-[52px] h-[52px] flex items-center justify-center rounded-md flex-shrink-0"
          style={{
            background: isFallback ? 'var(--color-fallback-bg)' : 'var(--color-briefing-bg)',
            border: `2px solid ${isFallback ? 'var(--color-fallback-border)' : 'var(--color-briefing-border)'}`,
          }}
          aria-hidden
        >
          <Sun
            className="w-[26px] h-[26px]"
            style={{ color: isFallback ? 'var(--color-fallback-border)' : 'var(--color-briefing-icon)' }}
          />
        </div>
        <div className="flex-1">
          <h1
            data-testid="briefing-detail-chantier-nom"
            className="font-heading font-bold text-[26px] text-primary m-0"
          >
            {chantierNom}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span data-testid="briefing-detail-semaine" className="badge badge-muted text-xs flex items-center gap-1">
              <Calendar className="w-3 h-3" aria-hidden />
              Semaine {briefingRaw.semaine_iso} — {briefingRaw.annee_iso}
            </span>
            <span
              data-testid="briefing-detail-date"
              className="text-[13px] text-[#94A3B8]"
            >
              {formatDateBriefing(briefingRaw.created_at)}
            </span>

            {/* Badge LLM */}
            {briefingRaw.llm_utilise ? (
              <span data-testid="briefing-detail-badge-llm" className="badge badge-success text-xs flex items-center gap-1">
                <Sparkles className="w-3 h-3" aria-hidden />
                Rédigé par Claude Sonnet
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
                Généré sans IA
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
                Météo disponible
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
                Météo indisponible
              </span>
            )}

            {/* Badge prospectif (D-7-15) */}
            <span
              data-testid="badge-briefing-prospectif"
              className="badge text-[11px]"
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
      </div>

      {/* ── Contenu du briefing (V-7-15 : JSX pur — jamais dangerouslySetInnerHTML) ── */}
      <div className="card-brutal p-6 mb-6">
        <h2 className="font-heading text-[14px] font-bold text-primary uppercase tracking-widest border-b-2 border-primary pb-1.5 mb-4">
          Synthèse de la semaine
        </h2>
        {/* V-7-15 BINDING : rendu texte brut via JSX — React échappe automatiquement */}
        <div
          data-testid="briefing-detail-contenu"
          className="text-[15px] text-[#222222] leading-[1.75] whitespace-pre-line"
        >
          {contenu}
        </div>
      </div>

      {/* ── Bloc météo 7 jours (ou état indisponible) ── */}
      {briefingRaw.meteo_disponible && meteoJours !== undefined ? (
        <div className="card-brutal p-6 mb-6" data-testid="briefing-detail-meteo-bloc">
          <h2 className="font-heading text-[14px] font-bold text-primary uppercase tracking-widest border-b-2 border-primary pb-1.5 mb-4">
            Météo de la semaine
            {briefingRaw.code_postal && (
              <span className="font-normal text-muted normal-case tracking-normal text-sm ml-2">
                — CP {briefingRaw.code_postal}
              </span>
            )}
          </h2>

          {/* Grille 7 jours */}
          <div className="grid grid-cols-7 gap-2 overflow-x-auto mb-5">
            {meteoJours.map((jour) => (
              <div
                key={jour.date_iso}
                data-testid={`briefing-detail-meteo-jour-${jour.date_iso}`}
                className="border-2 rounded-md p-2.5 text-center relative"
                style={{
                  background: getMeteoJourBg(jour),
                  borderColor: getMeteoJourBorder(jour),
                  boxShadow: '2px 2px 0 #000',
                }}
              >
                {/* Jour semaine abrégé */}
                <div className="text-[11px] font-bold text-[#555] mb-1">
                  {jour.jour_semaine.substring(0, 3)}
                </div>
                {/* Date */}
                <div className="text-[11px] text-[#94A3B8] mb-2">
                  {formatDateIso(jour.date_iso)}
                </div>
                {/* Icône météo */}
                <div className="flex justify-center mb-2">
                  <MeteoIcon jour={jour} />
                </div>
                {/* Températures */}
                <div className="text-[12px] font-semibold text-[#1F4E79]">
                  {jour.temp_min_c.toFixed(0)}° / {jour.temp_max_c.toFixed(0)}°
                </div>
                {/* Précipitations */}
                {jour.precipitation_mm > 0 && (
                  <div className="text-[11px] text-[#1E40AF] mt-1">
                    {jour.precipitation_mm.toFixed(0)} mm
                  </div>
                )}
                {/* Badges alerte sous la colonne */}
                <div className="mt-2 flex flex-col items-center gap-1">
                  {jour.alerte_pluie && (
                    <span
                      data-testid="briefing-detail-alerte-meteo-pluie"
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm"
                      style={{ background: '#DBEAFE', color: '#1E40AF', border: '1px solid #1E40AF' }}
                    >
                      PLUIE
                    </span>
                  )}
                  {jour.alerte_gel && (
                    <span
                      data-testid="briefing-detail-alerte-meteo-gel"
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm"
                      style={{ background: '#E0F2FE', color: '#0369A1', border: '1px solid #0369A1' }}
                    >
                      GEL
                    </span>
                  )}
                  {jour.alerte_canicule && (
                    <span
                      data-testid="briefing-detail-alerte-meteo-canicule"
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm"
                      style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #92400E' }}
                    >
                      CANI.
                    </span>
                  )}
                  {jour.alerte_vent && (
                    <span
                      data-testid="briefing-detail-alerte-meteo-vent"
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm"
                      style={{ background: '#F1F5F9', color: '#334155', border: '1px solid #64748B' }}
                    >
                      VENT
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Synthèse alertes BTP */}
          {alertesMeteo.length > 0 ? (
            <div>
              <h3 className="font-heading text-[12px] font-bold text-primary uppercase tracking-wider mb-2">
                Alertes terrain BTP cette semaine
              </h3>
              <div className="space-y-1.5">
                {alertesMeteo.map((alerte, i) => (
                  <div
                    key={`${alerte.type}-${i}`}
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-md"
                    style={{ background: alerte.bg, color: alerte.color, border: `1px solid ${alerte.border}` }}
                  >
                    {alerte.icon}
                    {/* V-7-15 : JSX pur */}
                    <span>{alerte.message}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="w-4 h-4" aria-hidden />
              Conditions météo favorables prévues toute la semaine.
            </div>
          )}
        </div>
      ) : !briefingRaw.meteo_disponible ? (
        /* Météo indisponible */
        <div
          className="card-brutal p-5 mb-6 flex items-start gap-3"
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
            <p className="text-sm text-muted mt-1">
              Les données météo n&apos;ont pas pu être récupérées ce matin (service temporairement indisponible).
              Consultez Météo France directement pour votre planning terrain.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
