'use client'
// app/admin/chantiers/[id]/tabs-client.tsx — migré Tabs shadcn (étape 8, E-07)
//
// Piège 6 component-mapping : Tabs shadcn est contrôlé (value + onValueChange)
//   Le sync searchParams est préservé via useRouter.push (pattern existant)
// data-testid sur TabsTrigger : préservés (annexe B)
// RG-MIGR-002 : commentaires RBAC: préservés
//
// Fix #5 (smoke prod Sprint 4) : onglet Photos activé, grille photos + delete admin
//   Props photos: PhotoConducteurDisplay[] ajoutée (server-side depuis page.tsx)
//   État local localPhotos pour optimistic delete (Sheet reste ouverte / grille mise à jour)
//   K4-HI-06 : referrerpolicy="no-referrer" sur <img> signed_url
//   D-4-006 : storage_path JAMAIS côté client (PhotoConducteurDisplay sans storage_path)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Chantier, TacheWithUser, AffectationWithUser, PhotoConducteurDisplay } from '@/types/database'
import { AffectationForm } from '@/components/AffectationForm'
import { TacheCreateModal } from '@/components/TacheCreateModal'
import { TacheEditModal } from '@/components/TacheEditModal'
import { RemoveAffectationButton } from '@/components/RemoveAffectationButton'
import { ConfirmDeletePhotoDialog } from '@/components/ouvrier/ConfirmDeletePhotoDialog'
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
import { useToast } from '@/lib/hooks/use-toast'

// ============================================================
// Types
// ============================================================

interface AssignableMember {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface DeletePhotoState {
  open: boolean
  photo: PhotoConducteurDisplay | null
  isLoading: boolean
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
  // Fix #5 : photos passées server-side (PhotoConducteurDisplay[] — sans storage_path, D-4-006)
  photos: PhotoConducteurDisplay[]
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
  photos: initialPhotos,
}: TabsClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<string>('infos')
  const [showAffectationForm, setShowAffectationForm] = useState(false)
  const [showTacheModal, setShowTacheModal] = useState(false)
  // Gap CRUD UPDATE (2026-06-09) : état modal édition tâche
  const [editTache, setEditTache] = useState<TacheWithUser | null>(null)
  // Fix #5 : état local photos pour optimistic delete (tab Photos reste actif après suppression)
  const [photos, setPhotos] = useState<PhotoConducteurDisplay[]>(initialPhotos)
  const [deletePhotoState, setDeletePhotoState] = useState<DeletePhotoState>({
    open: false,
    photo: null,
    isLoading: false,
  })
  const isArchive = chantier.statut === 'archive'

  // Fix #5 : photos regroupées par tache_id (même pattern que conducteur/client.tsx)
  const photosByTacheId = photos.reduce<Record<string, PhotoConducteurDisplay[]>>(
    (acc, photo) => {
      const arr = acc[photo.tache_id] ?? []
      arr.push(photo)
      acc[photo.tache_id] = arr
      return acc
    },
    {},
  )

  // Fix #5 : suppression photo admin — DELETE /api/photos/[id] (déjà autorisé role=admin par canDeletePhoto)
  async function handleDeletePhotoConfirm() {
    if (!deletePhotoState.photo) return
    setDeletePhotoState((prev) => ({ ...prev, isLoading: true }))

    try {
      const response = await fetch(`/api/photos/${deletePhotoState.photo.id}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 204) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la suppression')
      }

      const deletedId = deletePhotoState.photo.id
      setPhotos((prev) => prev.filter((p) => p.id !== deletedId))
      setDeletePhotoState({ open: false, photo: null, isLoading: false })
      toast({ title: 'Photo supprimée', description: 'La photo a été supprimée avec succès.' })
    } catch (err) {
      setDeletePhotoState((prev) => ({ ...prev, isLoading: false }))
      toast({
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Erreur lors de la suppression.',
        variant: 'destructive',
      })
    }
  }

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
          {/* Fix #5 : onglet Photos activé (smoke prod Sprint 4) */}
          <TabsTrigger value="photos" data-testid="tab-photos">
            Photos ({photos.length})
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

        {/* ============ Tab Photos — Fix #5 ============ */}
        {/* Admin peut voir + supprimer les photos (modération) — canDeletePhoto autorise role=admin */}
        {/* K4-HI-06 : referrerpolicy="no-referrer" sur tout <img> signed_url */}
        {/* D-4-006 : storage_path absent de PhotoConducteurDisplay (jamais transmis au client) */}
        <TabsContent value="photos" className="pt-4">
          {photos.length === 0 ? (
            <div className="card-brutal p-8 text-center" data-testid="admin-photos-empty">
              <p className="font-heading text-lg font-bold mb-2">Aucune photo</p>
              <p className="text-sm text-muted">
                {isArchive
                  ? 'Ce chantier est archivé.'
                  : 'Les ouvriers n\'ont pas encore déposé de photos.'}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Grille par tâche — même organisation que conducteur/client.tsx */}
              {taches.map((tache) => {
                const tachePhotos = photosByTacheId[tache.id] ?? []
                if (tachePhotos.length === 0) return null
                return (
                  <div key={tache.id}>
                    <h3 className="font-heading font-semibold text-sm mb-3 text-muted">
                      {tache.titre}
                      <span className="ml-2 font-normal">({tachePhotos.length} photo{tachePhotos.length > 1 ? 's' : ''})</span>
                    </h3>
                    <div
                      data-testid="admin-photos-grid"
                      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                    >
                      {tachePhotos.map((photo) => (
                        <div
                          key={photo.id}
                          className="relative"
                          style={{
                            border: '2px solid #000',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            aspectRatio: '1',
                            boxShadow: '2px 2px 0 0 #000',
                          }}
                        >
                          {/* K4-HI-06 : referrerpolicy="no-referrer" BINDING */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.signed_url}
                            alt={photo.commentaire ? `Photo : ${photo.commentaire}` : 'Photo de chantier'}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          {/* Bouton supprimer — modération admin */}
                          <button
                            data-testid={`admin-photo-delete-${photo.id}`}
                            onClick={() => setDeletePhotoState({ open: true, photo, isLoading: false })}
                            style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              backgroundColor: '#C00000',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '4px',
                              cursor: 'pointer',
                              minWidth: '28px',
                              minHeight: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            aria-label="Supprimer la photo"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                            </svg>
                          </button>
                          {/* K4-LOW-11 : commentaire text node — jamais innerHTML */}
                          {photo.commentaire && (
                            <div
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                backgroundColor: 'rgba(0,0,0,0.6)',
                                padding: '4px 6px',
                              }}
                            >
                              <p
                                style={{
                                  fontSize: '11px',
                                  color: '#fff',
                                  margin: 0,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {photo.commentaire}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {/* Photos sans tâche associée — cas edge, affiché séparément */}
              {photos.filter((p) => !taches.find((t) => t.id === p.tache_id)).length > 0 && (
                <div>
                  <h3 className="font-heading font-semibold text-sm mb-3 text-muted">Autres photos</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {photos
                      .filter((p) => !taches.find((t) => t.id === p.tache_id))
                      .map((photo) => (
                        <div
                          key={photo.id}
                          className="relative"
                          style={{
                            border: '2px solid #000',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            aspectRatio: '1',
                            boxShadow: '2px 2px 0 0 #000',
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.signed_url}
                            alt={photo.commentaire ? `Photo : ${photo.commentaire}` : 'Photo de chantier'}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          <button
                            data-testid={`admin-photo-delete-${photo.id}`}
                            onClick={() => setDeletePhotoState({ open: true, photo, isLoading: false })}
                            style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              backgroundColor: '#C00000',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '4px',
                              cursor: 'pointer',
                              minWidth: '28px',
                              minHeight: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            aria-label="Supprimer la photo"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
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

      {/* Fix #5 : Dialog confirmation suppression photo admin */}
      {deletePhotoState.photo && (
        <ConfirmDeletePhotoDialog
          open={deletePhotoState.open}
          onOpenChange={(open) => {
            if (!open) setDeletePhotoState({ open: false, photo: null, isLoading: false })
          }}
          onConfirm={handleDeletePhotoConfirm}
          photoSignedUrl={deletePhotoState.photo.signed_url}
          isLoading={deletePhotoState.isLoading}
          isConducteur={false}
        />
      )}
    </div>
  )
}

export default ChantierDetailAdminTabs
