'use client'
// app/conducteur/chantiers/[id]/client.tsx — migré Tabs + Button shadcn (étape 8, E-15)
//
// D-2.5-019 : SVG bottom-nav conservés (dans page.tsx parent)
// data-testid="remove-affectation-trigger" : préservé via RemoveAffectationButton (W006)

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TacheItem } from '@/components/TacheItem'
import { AffectationForm } from '@/components/AffectationForm'
import { RemoveAffectationButton } from '@/components/RemoveAffectationButton'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { Chantier, TacheWithUser, AffectationWithUser, Tache } from '@/types/database'

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
}

export function ChantierDetailConducteurClient({
  chantier: _chantier,
  chantierId,
  taches: initialTaches,
  affectations: initialAffectations,
  membres,
}: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>('taches')
  const [taches, setTaches] = useState<TacheWithUser[]>(initialTaches)
  const [affectations] = useState<AffectationWithUser[]>(initialAffectations)
  const [showAffectationForm, setShowAffectationForm] = useState(false)

  const handleUpdateTache = useCallback(
    async (
      tacheId: string,
      patch: Partial<Pick<Tache, 'statut' | 'bloque_raison'>>,
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
        </TabsList>

        {/* Tab Tâches */}
        <TabsContent value="taches" className="pt-2">
          <main className="pb-40 flex flex-col gap-3">
            {taches.length === 0 && (
              <div className="card-brutal-mobile p-6 text-center mt-2">
                <p className="font-heading font-bold text-base mb-1">Aucune tâche</p>
                <p className="text-xs text-muted">Créez la première tâche pour ce chantier.</p>
              </div>
            )}

            {taches.map((tache) => (
              <TacheItem
                key={tache.id}
                tache={tache}
                onUpdate={(patch) => handleUpdateTache(tache.id, patch)}
              />
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

        {/* Tab Équipe */}
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
                  </div>
                  {/* data-testid="remove-affectation-trigger" préservé (W006 Itachi) */}
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
    </div>
  )
}
