'use client'
// app/admin/chantiers/[id]/tabs-client.tsx
// Système de tabs admin — Informations / Tâches / Photos / Comptes-rendus
//
// T04 — système de tabs absent (P1)
// T05 — table-brutal appliqué directement sur <table> (P1)
// T19/T23 — tâches affichées en table-brutal (colonnes Tâche/Assigné/Statut/Échéance) (P2)
//
// Client Component — nécessaire pour useState (tab actif)
// Props : toutes sérialisables (primitives, strings, null) — pas de Dates, pas de fonctions
//
// Proto référencé : mockups/16-admin-chantier-detail.html l.151-156 (tabs) l.206-255 (tableau tâches)
// Design system Hana : .tab-brutal (globals.css T03), .table-brutal §4.13

import { useState } from 'react'
import type { Chantier, TacheWithUser, AffectationWithUser } from '@/types/database'

// ============================================================
// Types de props — uniquement des types sérialisables
// ============================================================

interface TabsClientProps {
  chantier: Chantier
  taches: TacheWithUser[]
  affectations: AffectationWithUser[]
  couleurStyles: {
    border: string
    badge: string
    label: string
  }
}

// ============================================================
// Helpers
// ============================================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

function formatMontant(amount: number | null): string {
  if (amount === null) return 'Non défini'
  return new Intl.NumberFormat('fr-FR').format(amount) + '€'
}

// Mapping statut tâche → classe badge (T19/T23)
function statutBadgeClass(statut: string): string {
  switch (statut) {
    case 'a_faire':   return 'badge badge-muted'
    case 'en_cours':  return 'badge badge-primary'
    case 'termine':   return 'badge badge-success'
    case 'bloque':    return 'badge badge-danger'
    default:          return 'badge badge-muted'
  }
}

// Mapping statut tâche → label affiché (T19/T23)
function statutLabel(statut: string): string {
  switch (statut) {
    case 'a_faire':   return 'À faire'
    case 'en_cours':  return 'En cours'
    case 'termine':   return 'Terminé'
    case 'bloque':    return 'Bloqué'
    default:          return statut
  }
}

// ============================================================
// Composant
// ============================================================

export function ChantierDetailAdminTabs({ chantier, taches, affectations, couleurStyles }: TabsClientProps) {
  const [activeTab, setActiveTab] = useState<'infos' | 'taches'>('infos')

  // Budget progress
  const budgetProgress = chantier.budget_alloue
    ? Math.min(Math.round((chantier.budget_depense / chantier.budget_alloue) * 100), 100)
    : 0

  const isEstDepasse = chantier.budget_alloue !== null
    && chantier.budget_depense > chantier.budget_alloue

  // Couleur de la barre de progression budget
  const progressBg = isEstDepasse ? 'bg-danger'
    : couleurStyles.label === 'Dérive' ? 'bg-warning'
    : 'bg-success'

  return (
    <div className="mt-6">
      {/* Tab bar — proto 16-admin-chantier-detail.html l.151-156 */}
      <div className="flex mb-6">
        {/* Tab Informations */}
        <button
          type="button"
          onClick={() => setActiveTab('infos')}
          className={`tab-brutal rounded-l-md border-r-0 ${activeTab === 'infos' ? 'active' : ''}`}
        >
          Informations
        </button>

        {/* Tab Tâches */}
        <button
          type="button"
          onClick={() => setActiveTab('taches')}
          className={`tab-brutal border-r-0 ${activeTab === 'taches' ? 'active' : ''}`}
        >
          Tâches ({taches.length})
        </button>

        {/* Tab Photos — Sprint 3, disabled */}
        <button
          type="button"
          disabled
          className="tab-brutal border-r-0 opacity-50 cursor-not-allowed"
          title="Disponible Sprint 3"
        >
          Photos
        </button>

        {/* Tab Comptes-rendus — Sprint 3, disabled */}
        <button
          type="button"
          disabled
          className="tab-brutal rounded-r-md opacity-50 cursor-not-allowed"
          title="Disponible Sprint 3"
        >
          Comptes-rendus
        </button>
      </div>

      {/* ============ Contenu tab Informations ============ */}
      {activeTab === 'infos' && (
        <div className="space-y-6">
          {/* Grille infos + budget — déplacée depuis page.tsx (T04) */}
          <div className="grid grid-cols-2 gap-6">
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
                      className={`progress-fill ${progressBg}`}
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

          {/* Affectations — dans le tab Informations (proto 16-admin-chantier-detail.html) */}
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
              /* T05 — table-brutal directement sur <table> (plus de <div> wrapper) */
              <table className="table-brutal">
                <thead>
                  <tr>
                    <th>Membre</th>
                    <th>Rôle</th>
                    <th>Début</th>
                    <th>Fin</th>
                  </tr>
                </thead>
                <tbody>
                  {affectations.map((aff) => (
                    <tr key={aff.id}>
                      <td className="font-semibold">
                        {aff.user?.prenom} {aff.user?.nom}
                      </td>
                      <td>
                        <span className={`badge text-xs ${aff.user?.role === 'conducteur' ? 'badge-primary' : 'badge-muted'}`}>
                          {aff.user?.role === 'conducteur' ? 'Conducteur' : 'Ouvrier'}
                        </span>
                      </td>
                      <td>{formatDate(aff.date_debut)}</td>
                      <td>{aff.date_fin ? formatDate(aff.date_fin) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ============ Contenu tab Tâches ============ */}
      {activeTab === 'taches' && (
        <div>
          {taches.length === 0 ? (
            <div className="card-brutal p-8 text-center">
              <p className="font-heading text-lg font-bold mb-2">Aucune tâche</p>
              <p className="text-sm text-muted">Les tâches sont créées par les conducteurs de chantier.</p>
            </div>
          ) : (
            /* T19/T23 — tableau tâches en table-brutal (proto 16-admin-chantier-detail.html l.206-255) */
            /* T05 — table-brutal directement sur <table> */
            <table className="table-brutal">
              <thead>
                <tr>
                  <th>Tâche</th>
                  <th>Assigné</th>
                  <th>Statut</th>
                  <th>Échéance</th>
                </tr>
              </thead>
              <tbody>
                {taches.map((t) => (
                  <tr key={t.id}>
                    <td className="font-semibold">{t.titre}</td>
                    <td>
                      {t.assigned_user
                        ? `${t.assigned_user.prenom} ${t.assigned_user.nom}`
                        : '—'}
                    </td>
                    <td>
                      <span className={statutBadgeClass(t.statut)}>
                        {statutLabel(t.statut)}
                      </span>
                    </td>
                    <td>{t.date_echeance ? formatDate(t.date_echeance) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default ChantierDetailAdminTabs
