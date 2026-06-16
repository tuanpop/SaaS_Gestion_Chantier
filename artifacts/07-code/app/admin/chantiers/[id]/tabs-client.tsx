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
//
// Sprint 5 : onglet CR activé — liste CRs + génération manuelle + section rapports-hebdo

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
// Sprint 5 — Reporting components
import { CrListItem } from '@/components/reporting/CrListItem'
import { RapportHebdoCard } from '@/components/reporting/RapportHebdoCard'
import { LlmLoadingCard } from '@/components/reporting/LlmLoadingCard'
import type { CompteRenduListe, RapportHebdoListe } from '@/types/reporting'
// Sprint 8 — Chat + propositions
import { ChatFilMessages } from '@/components/chat/ChatFilMessages'

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
  // Sprint 5 — données initiales reporting (server-side, pas de refetch client initial)
  crs?: CompteRenduListe[]
  rapportsHebdo?: RapportHebdoListe[]
  // Semaine ISO précédente — calculée server-side (évite hydration/timezone côté client)
  previousWeek?: {
    anneeIso: number
    semaineIso: number
    label: string
    lundi: string
  }
  // Sprint 8 — Chat
  currentUserId?: string
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
  crs: initialCrs = [],
  rapportsHebdo: initialRapportsHebdo = [],
  previousWeek,
  currentUserId = '',
}: TabsClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<string>('infos')
  // Sprint 5 — état génération CR
  const [isGeneratingCr, setIsGeneratingCr] = useState(false)
  const [crError, setCrError] = useState<string | null>(null)
  // Bouton générer rapport hebdo — US-045
  const [isGeneratingHebdo, setIsGeneratingHebdo] = useState(false)
  const [hebdoError, setHebdoError] = useState<string | null>(null)
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
          {/* Sprint 5 : onglet CR activé */}
          <TabsTrigger value="cr" data-testid="tab-cr">
            Comptes rendus ({initialCrs.length})
          </TabsTrigger>
          {/* Sprint 8 : onglet Chat */}
          <TabsTrigger value="chat" data-testid="tab-chat" id="chat">
            Chat
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

        {/* ============ Tab Comptes Rendus — Sprint 5 ============ */}
        <TabsContent value="cr" className="pt-4 space-y-8">
          {/* Section CRs journaliers */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading font-bold text-[22px]">Comptes rendus journaliers</h2>
              {/* Génération manuelle — admin/conducteur uniquement */}
              {!isArchive && (
                <Button
                  size="sm"
                  data-testid="admin-generer-cr"
                  disabled={isGeneratingCr}
                  onClick={async () => {
                    setIsGeneratingCr(true)
                    setCrError(null)
                    try {
                      const res = await fetch(`/api/chantiers/${chantierId}/cr/generer`, {
                        method: 'POST',
                        credentials: 'include',
                      })
                      if (!res.ok) {
                        const d = await res.json().catch(() => ({}))
                        setCrError((d as { error?: string }).error ?? 'Erreur lors de la génération.')
                      } else {
                        router.refresh()
                      }
                    } catch {
                      setCrError('Erreur réseau. Veuillez réessayer.')
                    } finally {
                      setIsGeneratingCr(false)
                    }
                  }}
                >
                  + Générer CR du jour
                </Button>
              )}
            </div>

            {crError && (
              <p className="text-sm text-[#C00000] border-2 border-[#C00000] rounded px-3 py-2 bg-[#FFCCCC] mb-4">
                {crError}
              </p>
            )}

            {isGeneratingCr && <LlmLoadingCard message="Génération du compte rendu en cours…" />}

            {!isGeneratingCr && initialCrs.length === 0 && (
              <div className="card-brutal p-8 text-center">
                <p className="font-heading text-lg font-bold mb-2">Aucun compte rendu</p>
                <p className="text-sm text-muted">
                  {isArchive
                    ? 'Ce chantier est archivé.'
                    : 'Le CR journalier sera généré automatiquement à 18h ou manuellement ici.'}
                </p>
              </div>
            )}

            {!isGeneratingCr && initialCrs.length > 0 && (
              <div className="space-y-2">
                {initialCrs.map((cr) => (
                  <CrListItem key={cr.id} cr={cr} basePath="/admin" />
                ))}
              </div>
            )}
          </div>

          {/* Section Rapports hebdo */}
          <div data-testid="section-rapports-hebdo">
            <h2 className="font-heading font-bold text-[22px] mb-4">Rapports hebdomadaires</h2>

            {/* Carte génération manuelle — semaine ISO précédente (US-045, design S5-06) */}
            {previousWeek && !isArchive && (
              <div
                className="card-brutal-sm p-4 mb-4"
                style={{ background: '#D6E4F0', borderColor: '#1F4E79', border: '2px solid #1F4E79', boxShadow: '3px 3px 0 #000', borderRadius: '6px' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F4E79" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <div>
                    <p style={{ fontFamily: 'var(--font-heading, Outfit, sans-serif)', fontWeight: 700, fontSize: '15px', color: '#1F4E79', margin: '0 0 2px' }}>
                      {previousWeek.label}
                    </p>
                    <p style={{ fontSize: '12px', color: '#555555', margin: 0 }}>
                      Génération manuelle du rapport hebdomadaire
                    </p>
                  </div>
                </div>

                {hebdoError && (
                  <p
                    style={{
                      fontSize: '13px',
                      color: '#C00000',
                      background: '#FFCCCC',
                      border: '2px solid #C00000',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      marginBottom: '10px',
                    }}
                    role="alert"
                  >
                    {hebdoError}
                  </p>
                )}

                {isGeneratingHebdo ? (
                  <LlmLoadingCard message="Génération du rapport hebdomadaire en cours…" />
                ) : (
                  <button
                    type="button"
                    data-testid="btn-generer-rapport-hebdo"
                    disabled={isGeneratingHebdo}
                    onClick={async () => {
                      setIsGeneratingHebdo(true)
                      setHebdoError(null)
                      try {
                        const res = await fetch(
                          `/api/chantiers/${chantierId}/rapports-hebdo/generer`,
                          {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              annee_iso: previousWeek.anneeIso,
                              semaine_iso: previousWeek.semaineIso,
                            }),
                          },
                        )
                        if (res.ok) {
                          const data = await res.json() as { id?: string }
                          if (data.id) {
                            router.push(`/admin/rapports-hebdo/${data.id}`)
                          } else {
                            router.refresh()
                          }
                        } else {
                          const d = await res.json().catch(() => ({})) as { error?: string }
                          if (res.status === 402) {
                            setHebdoError("Votre essai gratuit a expiré. Passez à un abonnement payant pour continuer.")
                          } else if (res.status === 409) {
                            setHebdoError("Ce rapport hebdomadaire est déjà validé et ne peut pas être régénéré.")
                          } else if (res.status === 502) {
                            setHebdoError("Le service de génération est temporairement indisponible. Réessayez dans quelques instants.")
                          } else {
                            setHebdoError(d.error ?? "Erreur lors de la génération du rapport hebdomadaire.")
                          }
                        }
                      } catch {
                        setHebdoError("Erreur réseau. Veuillez réessayer.")
                      } finally {
                        setIsGeneratingHebdo(false)
                      }
                    }}
                    style={{
                      width: '100%',
                      background: '#F97316',
                      color: '#fff',
                      border: '2px solid #000',
                      boxShadow: '3px 3px 0 #000',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-heading, Outfit, sans-serif)',
                      fontSize: '15px',
                      minHeight: '52px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      transition: 'transform 100ms, box-shadow 100ms',
                      opacity: isGeneratingHebdo ? 0.7 : 1,
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 2a10 10 0 1 0 10 10"/>
                      <path d="M12 8v4l3 3"/>
                      <path d="M18.4 6.2l1.8-1.8 1.8 1.8"/>
                    </svg>
                    Générer le rapport de la semaine {previousWeek.semaineIso}
                  </button>
                )}
              </div>
            )}

            {initialRapportsHebdo.length === 0 ? (
              <div className="card-brutal p-8 text-center">
                <p className="font-heading text-lg font-bold mb-2">Aucun rapport hebdomadaire</p>
                <p className="text-sm text-muted">
                  Les rapports sont générés automatiquement chaque lundi à 7h15.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {initialRapportsHebdo.map((r) => (
                  <RapportHebdoCard key={r.id} rapport={r} basePath="/admin" />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ============ Tab Chat — Sprint 8 ============ */}
        {/* US-066 : admin peut lire + écrire dans le chat
            US-083 : admin peut supprimer des messages (modération)
            EXI-8-06 BINDING : ChatFilMessages rend JSX pur — jamais dangerouslySetInnerHTML
            PO-8-01=A BINDING : polling 30s dans ChatFilMessages */}
        <TabsContent value="chat" className="pt-4">
          <div
            data-testid="chat-container-admin"
            className="card-brutal p-0 overflow-hidden"
            style={{ height: '600px', display: 'flex', flexDirection: 'column' }}
          >
            <div className="p-3 border-b-2 border-[var(--color-border-black)] bg-[var(--color-primary)] text-white">
              <h3 className="font-heading font-bold text-sm">Chat d&apos;équipe — {chantier.nom}</h3>
              <p className="text-xs opacity-75">
                Utilisez @claw pour interroger l&apos;assistant IA sur ce chantier.
              </p>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatFilMessages
                chantierId={chantierId}
                currentUserId={currentUserId}
                currentUserRole="admin"
              />
            </div>
          </div>
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
