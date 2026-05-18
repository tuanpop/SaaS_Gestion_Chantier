// app/(admin)/chantiers/[id]/page.tsx
// Détail chantier admin — infos, tâches, affectations
// Server Component — data fetching via adminClient
//
// Proto référencé :
//   mockups/16-admin-chantier-detail.html (tabs Informations / Tâches / Photos / CR)
//   mockups/15-admin-dashboard.html (structure sidebar)
//
// Sections :
//   1. Header : nom, client, pastille couleur, badge statut, dates, budget
//   2. Actions admin : bouton "Archiver" (confirmation)
//   3. Liste des tâches : TacheItem (lecture seule pour admin)
//   4. Liste des affectations actives

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calculerCouleur } from '@/lib/coloration'
import { TacheItem } from '@/components/TacheItem'
import { ArchiveButton } from './archive-button'
import type { Chantier, TacheWithUser, AffectationWithUser } from '@/types/database'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

// ============================================================
// Helpers
// ============================================================

const COULEUR_MAP = {
  rouge: { border: 'border-l-danger', badge: 'badge badge-danger', label: 'En retard' },
  orange: { border: 'border-l-warning', badge: 'badge badge-warning', label: 'Dérive' },
  vert: { border: 'border-l-success', badge: 'badge badge-success', label: 'OK' },
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

function formatMontant(amount: number | null): string {
  if (amount === null) return 'Non défini'
  return new Intl.NumberFormat('fr-FR').format(amount) + '€'
}

// ============================================================
// Page
// ============================================================

export default async function ChantierDetailAdminPage({ params }: PageProps) {
  const { id: chantierId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const adminClient = createAdminClient()

  // Récupérer le chantier
  const { data: chantierRaw, error } = await adminClient
    .from('chantiers')
    .select('*')
    .eq('id', chantierId)
    .eq('organisation_id', organisationId)
    .single()

  if (error || !chantierRaw) return notFound()

  const chantier = chantierRaw as unknown as Chantier
  const couleur = calculerCouleur(
    {
      date_fin_prevue: chantier.date_fin_prevue,
      budget_alloue: chantier.budget_alloue,
      budget_depense: chantier.budget_depense,
    },
    new Date(),
  )
  const couleurStyles = COULEUR_MAP[couleur]

  // Récupérer les tâches
  const { data: tachesRaw } = await adminClient
    .from('taches')
    .select(`
      id, chantier_id, organisation_id, titre, description,
      statut, assigned_to, date_echeance, bloque_raison, created_by, created_at, updated_at,
      assigned_user:users!taches_assigned_to_fkey (nom, prenom)
    `)
    .eq('chantier_id', chantierId)
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: true })

  const taches = (tachesRaw ?? []) as unknown as TacheWithUser[]

  // Récupérer les affectations
  const { data: affectationsRaw } = await adminClient
    .from('affectations')
    .select(`
      id, user_id, chantier_id, organisation_id, vue, date_debut, date_fin, created_by, created_at,
      user:users!affectations_user_id_fkey (nom, prenom, role)
    `)
    .eq('chantier_id', chantierId)
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: true })

  const affectations = (affectationsRaw ?? []) as unknown as AffectationWithUser[]

  // Budget progress
  const budgetProgress = chantier.budget_alloue
    ? Math.min(Math.round((chantier.budget_depense / chantier.budget_alloue) * 100), 100)
    : 0

  const isEstDepasse = chantier.budget_alloue !== null
    && chantier.budget_depense > chantier.budget_alloue

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/admin/chantiers"
            className="text-xs text-muted flex items-center gap-1 mb-2 hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Retour aux chantiers
          </Link>
          <div className="flex items-center gap-4">
            <h1 className="font-heading font-bold text-[28px]">{chantier.nom}</h1>
            <span className={`${couleurStyles.badge} text-sm`}>{couleurStyles.label}</span>
            {chantier.statut === 'archive' && (
              <span className="badge badge-muted text-sm">Archivé</span>
            )}
          </div>
          <p className="text-muted mt-1">Client : {chantier.client_nom}</p>
        </div>
        {/* Actions admin */}
        {chantier.statut === 'actif' && (
          <div className="flex gap-3">
            <Link
              href={`/admin/chantiers/${chantierId}/modifier`}
              className="btn-brutal bg-white text-primary text-sm py-2 px-4"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Modifier
            </Link>
            <ArchiveButton chantierId={chantierId} />
          </div>
        )}
      </div>

      {/* Grille infos + budget */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Informations */}
        <div className={`card-brutal p-6 border-l-[4px] ${couleurStyles.border}`}>
          <h3 className="font-heading font-semibold text-lg mb-4">Informations</h3>
          <div className="space-y-3">
            {[
              { label: 'Adresse', value: chantier.adresse },
              { label: 'Code postal', value: chantier.code_postal },
              { label: 'Date début', value: formatDate(chantier.date_debut) },
              { label: 'Date fin prévue', value: formatDate(chantier.date_fin_prevue) },
              ...(chantier.date_fin_reelle
                ? [{ label: 'Date fin réelle', value: formatDate(chantier.date_fin_reelle) }]
                : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-muted font-medium text-sm">{label}</span>
                <span className="font-semibold text-sm">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div className="card-brutal p-6">
          <h3 className="font-heading font-semibold text-lg mb-4">Budget</h3>
          {chantier.budget_alloue !== null ? (
            <>
              <div className="text-center mb-4">
                <span className="font-heading font-bold text-[32px]">
                  {formatMontant(chantier.budget_depense)}
                </span>
                <span className="text-muted text-lg"> / {formatMontant(chantier.budget_alloue)}</span>
              </div>
              <div className="progress-bar mb-3">
                <div
                  className={`progress-fill ${isEstDepasse ? 'bg-danger' : couleur === 'orange' ? 'bg-warning' : 'bg-success'}`}
                  style={{ width: `${budgetProgress}%` }}
                />
              </div>
              {isEstDepasse ? (
                <p className="text-danger font-bold text-center mb-3">
                  +{formatMontant(chantier.budget_depense - (chantier.budget_alloue ?? 0))} de dépassement
                </p>
              ) : (
                <p className="text-success font-bold text-center mb-3">
                  -{formatMontant((chantier.budget_alloue ?? 0) - chantier.budget_depense)} restant
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted font-medium">Budget non défini</p>
              <p className="text-xs text-muted mt-1">Ajoutez un budget lors de la modification.</p>
            </div>
          )}
        </div>
      </div>

      {/* Tâches */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-bold text-[22px]">
            Tâches
            <span className="ml-2 text-base font-normal text-muted">({taches.length})</span>
          </h2>
        </div>

        {taches.length === 0 ? (
          <div className="card-brutal p-8 text-center">
            <p className="font-heading text-lg font-bold mb-2">Aucune tâche</p>
            <p className="text-sm text-muted">Les tâches sont créées par les conducteurs de chantier.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {taches.map((tache) => (
              <TacheItem
                key={tache.id}
                tache={tache}
                // Admin = lecture seule (pas de onUpdate)
              />
            ))}
          </div>
        )}
      </div>

      {/* Affectations */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-bold text-[22px]">
            Équipe affectée
            <span className="ml-2 text-base font-normal text-muted">({affectations.length})</span>
          </h2>
        </div>

        {affectations.length === 0 ? (
          <div className="card-brutal p-8 text-center">
            <p className="font-heading text-lg font-bold mb-2">Aucun membre affecté</p>
            <p className="text-sm text-muted">Les conducteurs peuvent affecter des membres depuis leur espace.</p>
          </div>
        ) : (
          <div className="table-brutal overflow-hidden rounded-[6px]">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 bg-primary-dark text-white font-heading font-semibold text-sm border-b-2 border-black">Membre</th>
                  <th className="text-left px-4 py-3 bg-primary-dark text-white font-heading font-semibold text-sm border-b-2 border-black">Rôle</th>
                  <th className="text-left px-4 py-3 bg-primary-dark text-white font-heading font-semibold text-sm border-b-2 border-black">Début</th>
                  <th className="text-left px-4 py-3 bg-primary-dark text-white font-heading font-semibold text-sm border-b-2 border-black">Fin</th>
                </tr>
              </thead>
              <tbody>
                {affectations.map((aff) => (
                  <tr key={aff.id} className="border-b border-gray-100 hover:bg-surface transition-colors">
                    <td className="px-4 py-3 font-semibold text-sm">
                      {aff.user?.prenom} {aff.user?.nom}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge text-xs ${aff.user?.role === 'conducteur' ? 'badge-primary' : 'badge-muted'}`}>
                        {aff.user?.role === 'conducteur' ? 'Conducteur' : 'Ouvrier'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{formatDate(aff.date_debut)}</td>
                    <td className="px-4 py-3 text-sm">{aff.date_fin ? formatDate(aff.date_fin) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

