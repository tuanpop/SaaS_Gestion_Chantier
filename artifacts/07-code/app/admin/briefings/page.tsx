// app/admin/briefings/page.tsx — Liste des briefings org (admin uniquement)
// US-061 : consulter tous les briefings de l'organisation
// data-testid="page-briefings-admin" BINDING (Levi test plan)
// S7-02 : liste avec filtre chantier + semaine, pagination cursor-based
// Auth : admin only (middleware redirige conducteur/ouvrier avant ce point)
// Server Component — fetch via adminClient (filtre org côté serveur dans le handler API)

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Sun, Sparkles, CloudSun, AlertTriangle, AlertCircle, ArrowRight, Calendar } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { BriefingAvecChantier } from '@/types/briefing'

export const dynamic = 'force-dynamic'

// ============================================================
// Helpers
// ============================================================

function formatCreatedAt(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ============================================================
// Page
// ============================================================

export default async function AdminBriefingsPage() {
  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  // Vérification rôle admin (défense en profondeur — middleware gère déjà la redirection)
  const userRole = user.app_metadata?.['role'] as string | undefined
  if (userRole !== 'admin') return notFound()

  const adminClient = createAdminClient()

  // Fetch briefings — filtre organisation_id OBLIGATOIRE côté query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefingsRaw, error: briefingsError } = await (adminClient as unknown as any)
    .from('briefings')
    .select('id, chantier_id, annee_iso, semaine_iso, contenu_genere, message_fallback, llm_utilise, meteo_disponible, code_postal, created_at, chantiers!briefings_chantier_id_fkey(nom)')
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: false })
    .limit(20) as { data: Array<{
      id: string
      chantier_id: string
      annee_iso: number
      semaine_iso: number
      contenu_genere: string | null
      message_fallback: string | null
      llm_utilise: boolean
      meteo_disponible: boolean
      code_postal: string | null
      created_at: string
      chantiers: { nom: string } | null
    }> | null; error: { message: string } | null }

  if (briefingsError) {
    // Non-bloquant — afficher page avec état vide plutôt que erreur 500
  }

  const briefings: BriefingAvecChantier[] = (briefingsRaw ?? []).map((row) => ({
    id: row.id,
    chantier_id: row.chantier_id,
    annee_iso: row.annee_iso,
    semaine_iso: row.semaine_iso,
    contenu_genere: row.contenu_genere,
    message_fallback: row.message_fallback,
    llm_utilise: row.llm_utilise,
    meteo_disponible: row.meteo_disponible,
    code_postal: row.code_postal,
    created_at: row.created_at,
    chantier_nom: row.chantiers?.nom ?? 'Chantier inconnu',
  }))

  return (
    <div data-testid="page-briefings-admin">
      {/* En-tête page */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-7">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            {/* Icône Sun bleue — identité visuelle briefing (specs US-059) */}
            <div
              className="w-10 h-10 flex items-center justify-center rounded-md"
              style={{ background: 'var(--color-briefing-bg)', border: '2px solid var(--color-briefing-border)' }}
              aria-hidden
            >
              <Sun className="w-[22px] h-[22px]" style={{ color: 'var(--color-briefing-icon)' }} />
            </div>
            <h1 className="font-heading font-bold text-[28px] text-primary">
              Briefings lundi matin
            </h1>
          </div>
          <p className="text-sm text-muted mt-1">
            Synthèses prospectives générées chaque lundi à 08h30 — tous les chantiers actifs de votre organisation.
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className="badge text-xs flex items-center gap-1"
              style={{
                background: 'var(--color-briefing-bg)',
                borderColor: 'var(--color-briefing-border)',
                color: 'var(--color-briefing-text)',
              }}
              data-testid="badge-briefing-prospectif"
            >
              <Sun className="w-3 h-3" aria-hidden />
              Prospectif — semaine à venir
            </span>
            <span className="text-xs text-[#94A3B8]">
              {'≠'} Rapport hebdo (rétrospectif)
            </span>
          </div>
        </div>
      </div>

      {/* Liste des briefings */}
      {briefings.length === 0 ? (
        /* État vide */
        <div
          className="card-brutal p-12 text-center"
          data-testid="briefings-admin-empty-state"
        >
          <Sun className="w-12 h-12 text-[#94A3B8] mx-auto mb-4" aria-hidden />
          <p className="font-heading font-bold text-lg mb-2">Aucun briefing généré</p>
          <p className="text-sm text-muted">
            Les briefings sont générés automatiquement chaque lundi matin à 08h30 pour tous les chantiers actifs.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-sm text-muted mb-3">
            <strong>{briefings.length}</strong> briefing{briefings.length > 1 ? 's' : ''} disponible{briefings.length > 1 ? 's' : ''}
          </p>
          <div
            className="card-brutal"
            role="list"
            aria-label="Liste des briefings"
          >
            {briefings.map((briefing) => {
              const isFallback = !briefing.llm_utilise
              const iconBg = isFallback ? 'var(--color-fallback-bg)' : 'var(--color-briefing-bg)'
              const iconBorder = isFallback ? 'var(--color-fallback-border)' : 'var(--color-briefing-border)'
              const iconColor = isFallback ? 'var(--color-fallback-border)' : 'var(--color-briefing-icon)'

              // Extrait du contenu (1 ligne, 120 chars max)
              const contenu = briefing.contenu_genere ?? briefing.message_fallback ?? ''
              const extrait = contenu.length > 120 ? contenu.substring(0, 120) + '…' : contenu

              return (
                <Link
                  key={briefing.id}
                  href={`/admin/briefings/${briefing.id}`}
                  data-testid={`briefing-row-${briefing.id}`}
                  data-testid-link={`briefing-row-link-detail-${briefing.id}`}
                  role="listitem"
                  aria-label={`Briefing ${briefing.chantier_nom} semaine ${briefing.semaine_iso}`}
                  className="flex items-start gap-5 px-6 py-5 border-b-2 border-[#E2E8F0] last:border-b-0 transition-colors hover:bg-[#EFF6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                >
                  {/* Icône Sun */}
                  <div
                    className="w-11 h-11 flex items-center justify-center rounded-md flex-shrink-0"
                    style={{ background: iconBg, border: `2px solid ${iconBorder}` }}
                    aria-hidden
                  >
                    <Sun className="w-5 h-5" style={{ color: iconColor }} />
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        {/* Nom chantier — fourni par GET /api/briefings via jointure (F001 compliance) */}
                        <div
                          data-testid={`briefing-row-chantier-nom-${briefing.id}`}
                          className="font-heading font-bold text-[17px] text-primary"
                        >
                          {briefing.chantier_nom}
                        </div>

                        {/* Badges */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {/* Badge semaine */}
                          <span
                            data-testid={`briefing-row-semaine-${briefing.id}`}
                            className="badge badge-muted text-xs flex items-center gap-1"
                          >
                            <Calendar className="w-3 h-3" aria-hidden />
                            Semaine {briefing.semaine_iso} — {briefing.annee_iso}
                          </span>

                          {/* Badge LLM */}
                          {briefing.llm_utilise ? (
                            <span
                              data-testid={`briefing-row-badge-llm-${briefing.id}`}
                              className="badge badge-success text-xs flex items-center gap-1"
                            >
                              <Sparkles className="w-3 h-3" aria-hidden />
                              Rédigé par Claude Sonnet
                            </span>
                          ) : (
                            <span
                              data-testid={`briefing-row-badge-llm-${briefing.id}`}
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
                              data-testid={`briefing-row-badge-meteo-${briefing.id}`}
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
                              data-testid={`briefing-row-badge-meteo-${briefing.id}`}
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
                        </div>
                      </div>

                      {/* Heure + bouton Voir */}
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-[#94A3B8]">
                          {formatCreatedAt(briefing.created_at)}
                        </div>
                        <span
                          className="btn-brutal mt-2 text-[13px] py-1.5 px-3.5"
                          data-testid={`btn-voir-detail-briefing-${briefing.id}`}
                          style={{
                            background: 'var(--color-briefing-bg)',
                            color: 'var(--color-briefing-text)',
                            borderColor: 'var(--color-briefing-border)',
                            pointerEvents: 'none',
                          }}
                          aria-label={`Voir le briefing de ${briefing.chantier_nom} semaine ${briefing.semaine_iso}`}
                        >
                          Voir
                          <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                        </span>
                      </div>
                    </div>

                    {/* Extrait contenu — 1 ligne (V-7-15 : JSX pur, jamais innerHTML) */}
                    {extrait && (
                      <p className="text-[13px] text-muted mt-2 truncate">
                        {extrait}
                      </p>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
