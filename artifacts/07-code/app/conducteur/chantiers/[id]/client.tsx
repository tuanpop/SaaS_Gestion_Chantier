'use client'
// app/conducteur/chantiers/[id]/client.tsx — Sprint 4 : note privée + téléphone + grille modération photos
//
// S4-F02 : handleUpdateTache accepte note_privee_conducteur (séparation statut vs note — RG-NPR-002)
//           telephone affiché dans onglet Équipe (lien tel: si non null — RG-TEL-001)
// F005/D-4-019 : grille modération photos par tâche (maquette 03-moderation-photo-conducteur-sprint-4.html)
//
// Items securite :
//   K4-HI-06 : referrerpolicy="no-referrer" sur tout img signed_url
//   K4-LOW-11 : commentaire rendu en text node (jamais innerHTML/dangerouslySetInnerHTML)
//   K4-MED-14 : badge "Interne" permanent dans TacheItem (verifie via prop onUpdateNotePrivee)
//   K4-NPR-01 : non-regression note_privee_conducteur absent payload ouvrier (route distincte)

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TacheItem } from '@/components/TacheItem'
import { TacheEditModal } from '@/components/TacheEditModal'
import { AffectationForm } from '@/components/AffectationForm'
import { RemoveAffectationButton } from '@/components/RemoveAffectationButton'
import { ConfirmDeletePhotoDialog } from '@/components/ouvrier/ConfirmDeletePhotoDialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useToast } from '@/lib/hooks/use-toast'
import type { Chantier, TacheWithUser, AffectationWithUser, Tache, PhotoConducteurDisplay } from '@/types/database'
// Sprint 5 — Reporting
import { CrListItem } from '@/components/reporting/CrListItem'
import { RapportHebdoCard } from '@/components/reporting/RapportHebdoCard'
import { LlmLoadingCard } from '@/components/reporting/LlmLoadingCard'
import type { CompteRenduListe, RapportHebdoListe } from '@/types/reporting'
// Sprint 8 — Chat
import { ChatFilMessages } from '@/components/chat/ChatFilMessages'

interface MembreOption {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface Props {
  chantier: Chantier
  chantierId: string
  taches: TacheWithUser[]
  affectations: AffectationWithUser[]
  membres: MembreOption[]
  photos: PhotoConducteurDisplay[]  // F005/D-4-019 : passees server-side
  // Sprint 5 — Reporting
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

interface DeletePhotoState {
  open: boolean
  photo: PhotoConducteurDisplay | null
  isLoading: boolean
}

export function ChantierDetailConducteurClient({
  chantier: _chantier,
  chantierId,
  taches: initialTaches,
  affectations: initialAffectations,
  membres,
  photos: initialPhotos,
  crs: initialCrs = [],
  rapportsHebdo: initialRapportsHebdo = [],
  previousWeek,
  currentUserId = '',
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<string>('taches')
  const [taches, setTaches] = useState<TacheWithUser[]>(initialTaches)
  const [affectations] = useState<AffectationWithUser[]>(initialAffectations)
  const [photos, setPhotos] = useState<PhotoConducteurDisplay[]>(initialPhotos)
  const [showAffectationForm, setShowAffectationForm] = useState(false)
  const [deleteState, setDeleteState] = useState<DeletePhotoState>({
    open: false,
    photo: null,
    isLoading: false,
  })

  // Gap CRUD UPDATE (2026-06-09) : état modal édition tâche
  const [editTache, setEditTache] = useState<TacheWithUser | null>(null)

  // Sprint 5 — génération CR
  const [isGeneratingCr, setIsGeneratingCr] = useState(false)
  const [crError, setCrError] = useState<string | null>(null)
  // Bouton générer rapport hebdo — US-045
  const [isGeneratingHebdo, setIsGeneratingHebdo] = useState(false)
  const [hebdoError, setHebdoError] = useState<string | null>(null)

  // handleUpdateTache — S4-F02 : accepte note_privee_conducteur (RG-NPR-002 : PATCH séparé)
  const handleUpdateTache = useCallback(
    async (
      tacheId: string,
      patch: Partial<Pick<Tache, 'statut' | 'bloque_raison' | 'note_privee_conducteur'>>,
    ) => {
      const response = await fetch(`/api/taches/${tacheId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la mise à jour')
      }

      const updated = await response.json() as TacheWithUser
      setTaches((prev) =>
        prev.map((t) => (t.id === tacheId ? { ...t, ...updated } : t)),
      )
    },
    [],
  )

  // handleUpdateNotePrivee — S4-F02 : PATCH note_privee_conducteur séparé du statut (RG-NPR-002)
  const handleUpdateNotePrivee = useCallback(
    async (tacheId: string, note: string | null) => {
      await handleUpdateTache(tacheId, { note_privee_conducteur: note })
    },
    [handleUpdateTache],
  )

  // handleDeletePhoto — F005/D-4-019 : suppression modération conducteur
  // DELETE /api/photos/[id] chemin staff (D-4-002 — JWT re-valide côté handler)
  const handleDeletePhotoConfirm = useCallback(async () => {
    if (!deleteState.photo) return
    setDeleteState((prev) => ({ ...prev, isLoading: true }))

    try {
      const response = await fetch(`/api/photos/${deleteState.photo.id}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 204) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? 'Erreur lors de la suppression')
      }

      // Optimistic update : retirer la photo de la liste locale
      setPhotos((prev) => prev.filter((p) => p.id !== deleteState.photo?.id))
      setDeleteState({ open: false, photo: null, isLoading: false })
      toast({
        title: 'Photo supprimée',
        description: 'La photo a été supprimée avec succès.',
      })
    } catch (err) {
      setDeleteState((prev) => ({ ...prev, isLoading: false }))
      toast({
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Erreur lors de la suppression.',
        variant: 'destructive',
      })
    }
  }, [deleteState.photo, toast])

  // Photos regroupées par tache_id (F005/D-4-019 — grille par tâche)
  const photosByTacheId = photos.reduce<Record<string, PhotoConducteurDisplay[]>>(
    (acc, photo) => {
      const arr = acc[photo.tache_id] ?? []
      arr.push(photo)
      acc[photo.tache_id] = arr
      return acc
    },
    {},
  )

  return (
    <div>
      {/* Tabs — shadcn Tabs contrôlées */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="px-4 pt-3">
        <TabsList>
          <TabsTrigger value="taches" data-testid="tab-conducteur-taches">
            Tâches ({taches.length})
          </TabsTrigger>
          <TabsTrigger value="equipe" data-testid="tab-conducteur-equipe">
            Équipe ({affectations.length})
          </TabsTrigger>
          {/* Sprint 5 : onglet CR */}
          <TabsTrigger value="cr" data-testid="tab-conducteur-cr">
            CR ({initialCrs.length})
          </TabsTrigger>
          {/* Sprint 8 : onglet Chat */}
          <TabsTrigger value="chat" data-testid="tab-conducteur-chat" id="chat">
            Chat
          </TabsTrigger>
        </TabsList>

        {/* Tab Tâches — S4-F02 note privée + F005 grille photos par tâche */}
        <TabsContent value="taches" className="pt-2">
          <main className="pb-40 flex flex-col gap-3">
            {taches.length === 0 && (
              <div className="card-brutal-mobile p-6 text-center mt-2">
                <p className="font-heading font-bold text-base mb-1">Aucune tâche</p>
                <p className="text-xs text-muted">Créez la première tâche pour ce chantier.</p>
              </div>
            )}

            {taches.map((tache) => (
              <div key={tache.id}>
                {/* TacheItem avec note privée (S4-F02) */}
                <TacheItem
                  tache={tache}
                  onUpdate={(patch) => handleUpdateTache(tache.id, patch)}
                  onUpdateNotePrivee={(note) => handleUpdateNotePrivee(tache.id, note)}
                  onEdit={() => setEditTache(tache)}
                />

                {/* F005/D-4-019 — Grille photos modération par tâche (maquette 03) */}
                {(photosByTacheId[tache.id] ?? []).length > 0 && (
                  <div className="mt-2 pl-1">
                    <p className="text-xs text-muted font-semibold mb-1">
                      Photos ({(photosByTacheId[tache.id] ?? []).length})
                    </p>
                    <div
                      data-testid="conducteur-photos-grid"
                      className="grid grid-cols-2 gap-2"
                    >
                      {(photosByTacheId[tache.id] ?? []).map((photo) => (
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
                          {/* K4-HI-06 : referrerpolicy="no-referrer" sur tout img signed_url */}
                          {/* K4-LOW-11 : commentaire en text node (jamais innerHTML) */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.signed_url}
                            alt={photo.commentaire ? `Photo : ${photo.commentaire}` : 'Photo de chantier'}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          {/* Bouton supprimer — modération conducteur */}
                          <button
                            data-testid="conducteur-photo-delete"
                            onClick={() => setDeleteState({ open: true, photo, isLoading: false })}
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
                          {/* Commentaire — text node (jamais innerHTML — K4-LOW-11) */}
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
                                {/* K4-LOW-11 : text node React — pas de dangerouslySetInnerHTML */}
                                {photo.commentaire}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Boutons d'action */}
            <div className="flex flex-col gap-2 mt-2">
              <Button asChild size="lg" className="w-full">
                <Link href={`/conducteur/chantiers/${chantierId}/taches/nouvelle`}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Ajouter une tâche
                </Link>
              </Button>

              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => setShowAffectationForm(true)}
                className="w-full"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                </svg>
                Affecter un membre
              </Button>
            </div>
          </main>
        </TabsContent>

        {/* Tab Équipe — S4-F02 : affichage telephone (RG-TEL-001) */}
        <TabsContent value="equipe" className="pt-2">
          <div className="pb-40 flex flex-col gap-3">
            {affectations.length === 0 ? (
              <div className="card-brutal-mobile p-6 text-center mt-2">
                <p className="font-heading font-bold text-base mb-1">Aucun membre affecté</p>
                <p className="text-xs text-muted">Affectez des membres à ce chantier.</p>
              </div>
            ) : (
              affectations.map((aff) => (
                <div key={aff.id} className="card-brutal-mobile p-3 flex items-center gap-3">
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarFallback className="text-sm font-bold">
                      {aff.user?.prenom?.[0] ?? '?'}{aff.user?.nom?.[0] ?? ''}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-heading font-semibold text-sm">
                      {aff.user?.prenom} {aff.user?.nom}
                    </div>
                    <div className="text-muted text-xs">
                      {aff.user?.role === 'conducteur' ? 'Conducteur' : 'Ouvrier'}
                      {' · '}
                      Depuis {new Date(aff.date_debut).toLocaleDateString('fr-FR')}
                    </div>
                    {/* S4-F02 — RG-TEL-001 : lien tel: si telephone non null */}
                    {aff.user?.telephone && (
                      <a
                        data-testid="conducteur-btn-appel-membre"
                        href={`tel:${aff.user.telephone}`}
                        className="text-xs text-primary font-medium flex items-center gap-1 mt-1"
                        style={{ touchAction: 'manipulation' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.63 19.79 19.79 0 01.07 2a2 2 0 012-2.18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.19 6.19l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2z"/>
                        </svg>
                        {/* text node — pas d'injection HTML */}
                        {aff.user.telephone}
                      </a>
                    )}
                  </div>
                  {/* data-testid="remove-affectation-trigger" préservé (W006) */}
                  <RemoveAffectationButton
                    affectationId={aff.id}
                    memberName={`${aff.user?.prenom ?? ''} ${aff.user?.nom ?? ''}`.trim()}
                    variant="compact"
                  />
                </div>
              ))
            )}

            <Button
              type="button"
              size="lg"
              onClick={() => setShowAffectationForm(true)}
              className="w-full mt-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
              Affecter un membre
            </Button>
          </div>
        </TabsContent>

        {/* ============ Tab Comptes Rendus — Sprint 5 ============ */}
        <TabsContent value="cr" className="pt-2">
          <div className="pb-40 flex flex-col gap-4">
            {/* Section CRs journaliers */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading font-bold text-base">Comptes rendus journaliers</h3>
                <Button
                  size="sm"
                  data-testid="conducteur-generer-cr"
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
                  className="text-xs"
                >
                  + Générer CR
                </Button>
              </div>

              {crError && (
                <p className="text-xs text-[#C00000] border-2 border-[#C00000] rounded px-3 py-2 bg-[#FFCCCC] mb-3">
                  {crError}
                </p>
              )}

              {isGeneratingCr && (
                <LlmLoadingCard message="Génération du compte rendu en cours…" />
              )}

              {!isGeneratingCr && initialCrs.length === 0 && (
                <div className="card-brutal-mobile p-6 text-center">
                  <p className="font-heading font-bold text-base mb-1">Aucun compte rendu</p>
                  <p className="text-xs text-muted">Le CR journalier sera généré automatiquement à 18h.</p>
                </div>
              )}

              {!isGeneratingCr && initialCrs.length > 0 && (
                <div className="space-y-2">
                  {initialCrs.map((cr) => (
                    <CrListItem key={cr.id} cr={cr} basePath="/conducteur" />
                  ))}
                </div>
              )}
            </div>

            {/* Section Rapports hebdo */}
            <div data-testid="section-rapports-hebdo">
              <h3 className="font-heading font-bold text-base mb-3">Rapports hebdomadaires</h3>

              {/* Carte génération manuelle — semaine ISO précédente (US-045, design S5-06) */}
              {previousWeek && (
                <div
                  className="mb-3"
                  style={{ background: '#D6E4F0', border: '2px solid #1F4E79', boxShadow: '3px 3px 0 #000', borderRadius: '6px', padding: '14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F4E79" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <div>
                      <p style={{ fontFamily: 'var(--font-heading, Outfit, sans-serif)', fontWeight: 700, fontSize: '14px', color: '#1F4E79', margin: '0 0 2px' }}>
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
                        fontSize: '12px',
                        color: '#C00000',
                        background: '#FFCCCC',
                        border: '2px solid #C00000',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        marginBottom: '8px',
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
                              router.push(`/conducteur/rapports-hebdo/${data.id}`)
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
                        fontSize: '14px',
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
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
                <div className="card-brutal-mobile p-6 text-center">
                  <p className="font-heading font-bold text-base mb-1">Aucun rapport hebdo</p>
                  <p className="text-xs text-muted">Générés automatiquement chaque lundi à 7h15.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {initialRapportsHebdo.map((r) => (
                    <RapportHebdoCard key={r.id} rapport={r} basePath="/conducteur" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ============ Tab Chat — Sprint 8 ============ */}
        {/* US-066 : conducteur peut lire + écrire dans le chat
            EXI-8-06 BINDING : ChatFilMessages rend JSX pur
            PO-8-01=A BINDING : polling 30s dans ChatFilMessages */}
        <TabsContent value="chat" className="pt-2">
          {/* Sprint 8 — point d'entrée vers la file des propositions du bot (US-072) */}
          <Link
            href={`/conducteur/chantiers/${chantierId}/propositions`}
            data-testid="link-propositions-conducteur"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px',
              marginBottom: '12px',
              background: '#163958',
              color: '#fff',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '14px',
              borderRadius: '8px',
              textDecoration: 'none',
            }}
          >
            📋 Propositions à valider
          </Link>
          <div
            data-testid="chat-container-conducteur"
            className="card-brutal-mobile overflow-hidden"
            // Hauteur responsive : tient dans le viewport au-dessus du .bottom-nav fixe (z-50, ~72px).
            // marginBottom dégage l'input de la barre de navigation fixe sur mobile.
            style={{
              height: 'calc(100dvh - 20rem)',
              minHeight: '18rem',
              maxHeight: '600px',
              marginBottom: '5rem',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="p-3 border-b-2 border-[var(--color-border-black)] bg-[var(--color-primary)] text-white">
              <h3 className="font-heading font-bold text-sm">Chat d&apos;équipe</h3>
              <p className="text-xs opacity-75">Utilisez @claw pour interroger l&apos;assistant IA.</p>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatFilMessages
                chantierId={chantierId}
                currentUserId={currentUserId}
                currentUserRole="conducteur"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal AffectationForm */}
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

      {/* Modal édition tâche — Gap CRUD UPDATE (2026-06-09) */}
      {editTache && (
        <TacheEditModal
          tache={editTache}
          membres={membres}
          onSuccess={() => {
            setEditTache(null)
            router.refresh()
          }}
          onClose={() => setEditTache(null)}
        />
      )}

      {/* Dialog confirmation suppression photo conducteur (F005/D-4-019) */}
      {deleteState.photo && (
        <ConfirmDeletePhotoDialog
          open={deleteState.open}
          onOpenChange={(open) => {
            if (!open) setDeleteState((prev) => ({ ...prev, open: false, photo: null }))
          }}
          onConfirm={handleDeletePhotoConfirm}
          photoSignedUrl={deleteState.photo.signed_url}
          isLoading={deleteState.isLoading}
          isConducteur={true}
        />
      )}
    </div>
  )
}
