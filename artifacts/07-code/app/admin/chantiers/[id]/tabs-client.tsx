'use client'
// app/admin/chantiers/[id]/tabs-client.tsx — migré Tabs shadcn (étape 8, E-07)
//
// Piège 6 component-mapping : Tabs shadcn est contrôlé (value + onValueChange)
//   Le sync searchParams est préservé via useRouter.push (pattern existant)
// data-testid sur TabsTrigger : préservés (annexe B)
// RG-MIGR-002 : commentaires RBAC: préservés

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Chantier, TacheWithUser, AffectationWithUser } from '@/types/database'
import { AffectationForm } from '@/components/AffectationForm'
import { TacheCreateModal } from '@/components/TacheCreateModal'
import { TacheEditModal } from '@/components/TacheEditModal'
import { RemoveAffectationButton } from '@/components/RemoveAffectationButton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Fragment } from 'react'

// ============================================================
// Types
// ============================================================

interface AssignableMember {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface TabsClientProps {
  chantier: Chantier
  chantierId: string
  taches: TacheWithUser[]
  affectations: AffectationWithUser[]
  membres: AssignableMember[]
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

function statutBadgeVariant(statut: string): 'muted' | 'primary' | 'success' | 'danger' {
  switch (statut) {
    case 'a_faire':  return 'muted'
    case 'en_cours': return 'primary'
    case 'termine':  return 'success'
    case 'bloque':   return 'danger'
    default:         return 'muted'
  }
}

function statutLabel(statut: string): string {
  switch (statut) {
    case 'a_faire':  return 'À faire'
    case 'en_cours': return 'En cours'
    case 'termine':  return 'Terminé'
    case 'bloque':   return 'Bloqué'
    default:         return statut
  }
}

// ============================================================
// Composant
// ============================================================

export function ChantierDetailAdminTabs({
  chantier,
  chantierId,
  taches,
  affectations,
  membres,
  couleurStyles,
}: TabsClientProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>('infos')
  const [showAffectationForm, setShowAffectationForm] = useState(false)
  const [showTacheModal, setShowTacheModal] = useState(false)
  // Gap CRUD UPDATE (2026-06-09) : état modal édition tâche
  const [editTache, setEditTache] = useState<TacheWithUser | null>(null)
  const isArchive = chantier.statut === 'archive'

  const budgetProgress = chantier.budget_alloue
    ? Math.min(Math.round((chantier.budget_depense / chantier.budget_alloue) * 100), 100)
    : 0

  const isEstDepasse = chantier.budget_alloue !== null
    && chantier.budget_depense > chantier.budget_alloue

  const progressBg = isEstDepasse ? 'bg-danger'
    : couleurStyles.label === 'Dérive' ? 'bg-warning'
    : 'bg-success'

  return (
    <div className="mt-6">
      {/* Tabs shadcn — piège 6 : valeur contrôlée (pas de sync searchParams ici, tabs locaux) */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList>
          {/* data-testid sur TabsTrigger (annexe B) */}
          <TabsTrigger value="infos" data-testid="tab-infos">
            Informations
          </TabsTrigger>
          <TabsTrigger value="taches" data-testid="tab-taches">
            Tâches ({taches.length})
          </TabsTrigger>
          <TabsTrigger value="photos" disabled className="opacity-50 cursor-not-allowed" title="Disponible Sprint 3">
            Photos
          </TabsTrigger>
          <TabsTrigger value="cr" disabled className="opacity-50 cursor-not-allowed" title="Disponible Sprint 3">
            Comptes-rendus
          </TabsTrigger>
        </TabsList>

        {/* ============ Tab Informations ============ */}
        <TabsContent value="infos" className="space-y-6 pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                </div>
              )}
            </div>
          </div>

          {/* Affectations */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading font-bold text-[22px]">
                Équipe affectée
                <span className="ml-2 text-base font-normal text-muted">({affectations.length})</span>
              </h2>
              {/* RBAC: visible admin only */}
              {!isArchive && (
                <Button
                  type="button"
                  data-testid="admin-affecter-membre"
                  onClick={() => setShowAffectationForm(true)}
                  size="sm"
                >
                  + Affecter un membre
                </Button>
              )}
            </div>

            {affectations.length === 0 ? (
              <div className="card-brutal p-8 text-center">
                <p className="font-heading text-lg font-bold mb-2">Aucun membre affecté</p>
                <p className="text-sm text-muted">
                  {isArchive
                    ? 'Ce chantier est archivé.'
                    : 'Cliquez sur « Affecter un membre » pour démarrer.'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Membre</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Début</TableHead>
                    <TableHead>Fin</TableHead>
                    {!isArchive && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {affectations.map((aff) => (
                    <TableRow key={aff.id}>
                      <TableCell className="font-semibold">
                        {aff.user?.prenom} {aff.user?.nom}
                      </TableCell>
                      <TableCell>
                        <Badge variant={aff.user?.role === 'conducteur' ? 'primary' : 'muted'}>
                          {aff.user?.role === 'conducteur' ? 'Conducteur' : 'Ouvrier'}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(aff.date_debut)}</TableCell>
                      <TableCell>{aff.date_fin ? formatDate(aff.date_fin) : '—'}</TableCell>
                      {!isArchive && (
                        <TableCell className="text-right">
                          <RemoveAffectationButton
                            affectationId={aff.id}
                            memberName={`${aff.user?.prenom ?? ''} ${aff.user?.nom ?? ''}`.trim()}
                            variant="compact"
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ============ Tab Tâches ============ */}
        <TabsContent value="taches" className="pt-4">
          {/* RBAC: visible admin only */}
          {!isArchive && (
            <div className="flex justify-end mb-4">
              <Button
                type="button"
                data-testid="admin-nouvelle-tache"
                onClick={() => setShowTacheModal(true)}
                size="sm"
              >
                + Nouvelle tâche
              </Button>
            </div>
          )}

          {taches.length === 0 ? (
            <div className="card-brutal p-8 text-center">
              <p className="font-heading text-lg font-bold mb-2">Aucune tâche</p>
              <p className="text-sm text-muted">
                {isArchive
                  ? 'Ce chantier est archivé.'
                  : 'Cliquez sur « Nouvelle tâche » pour démarrer.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tâche</TableHead>
                  <TableHead>Assigné</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Échéance</TableHead>
                  {/* Gap CRUD UPDATE (2026-06-09) : colonne Actions — visible si chantier non archivé */}
                  {!isArchive && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {taches.map((t) => (
                  <Fragment key={t.id}>
                    <TableRow>
                      <TableCell className="font-semibold">{t.titre}</TableCell>
                      <TableCell>
                        {t.assigned_user
                          ? `${t.assigned_user.prenom} ${t.assigned_user.nom}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statutBadgeVariant(t.statut)}>
                          {statutLabel(t.statut)}
                        </Badge>
                      </TableCell>
                      <TableCell>{t.date_echeance ? formatDate(t.date_echeance) : '—'}</TableCell>
                      {/* Gap CRUD UPDATE (2026-06-09) : bouton Modifier — reachability UI obligatoire (CLAUDE.md) */}
                      {!isArchive && (
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditTache(t)}
                            data-testid={`admin-tache-edit-${t.id}`}
                            className="text-xs"
                          >
                            Modifier
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    {/* RG-REACH-004 : motif blocage visible côté admin (Sprint 2 dette) */}
                    {t.statut === 'bloque' && t.bloque_raison && (
                      <TableRow key={`${t.id}-raison`} className="bg-danger-bg/30">
                        <TableCell colSpan={isArchive ? 4 : 5} className="text-sm text-danger">
                          <span className="font-semibold">Motif du blocage :</span>{' '}
                          {t.bloque_raison}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      {/* Modals */}
      {showAffectationForm && (
        <AffectationForm
          chantierId={chantierId}
          ouvriers={membres}
          onSuccess={() => {
            setShowAffectationForm(false)
            router.refresh()
          }}
          onClose={() => setShowAffectationForm(false)}
        />
      )}

      {showTacheModal && (
        <TacheCreateModal
          chantierId={chantierId}
          membres={membres}
          onSuccess={() => {
            setShowTacheModal(false)
            router.refresh()
          }}
          onClose={() => setShowTacheModal(false)}
        />
      )}

      {/* Modal édition tâche — Gap CRUD UPDATE (2026-06-09) */}
      {/* membres assignables = membres affectés au chantier (extraits des affectations) */}
      {editTache && (
        <TacheEditModal
          tache={editTache}
          membres={affectations
            .filter((aff) => aff.user !== null && aff.user !== undefined)
            .map((aff) => {
              const role = aff.user?.role
              return {
                id: aff.user_id,
                nom: aff.user?.nom ?? '',
                prenom: aff.user?.prenom ?? '',
                // admin ne peut pas être assigné à une tâche (role ouvrier/conducteur seulement)
                // mais on l'inclut comme conducteur pour ne pas perdre l'affichage
                role: (role === 'conducteur' ? 'conducteur' : 'ouvrier') as 'ouvrier' | 'conducteur',
              }
            })}
          onSuccess={() => {
            setEditTache(null)
            router.refresh()
          }}
          onClose={() => setEditTache(null)}
        />
      )}
    </div>
  )
}

export default ChantierDetailAdminTabs
