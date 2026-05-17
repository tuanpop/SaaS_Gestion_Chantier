'use client'
// app/(conducteur)/chantiers/[id]/client.tsx
// Client Component — interactions de la page détail chantier conducteur
// Séparé du Server Component page.tsx pour permettre les interactions React (état local)
//
// Gère :
//   - Tabs : Tâches / Équipe
//   - Mise à jour de statut des tâches (onUpdate via PATCH /api/taches/[id])
//   - Affichage AffectationForm (modal)
//   - Bouton "Nouvelle tâche" -> /conducteur/chantiers/[id]/taches/nouvelle

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TacheItem } from '@/components/TacheItem'
import { AffectationForm } from '@/components/AffectationForm'
import type { Chantier, TacheWithUser, AffectationWithUser, Tache } from '@/types/database'

interface MembreOption {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface Props {
  chantier: Chantier // transmis via _chantier destructuring — non utilisé directement dans ce composant
  chantierId: string
  taches: TacheWithUser[]
  affectations: AffectationWithUser[]
  membres: MembreOption[]
}

export function ChantierDetailConducteurClient({
  chantier: _chantier, // transmis au layout parent, non utilisé directement ici
  chantierId,
  taches: initialTaches,
  affectations: initialAffectations,
  membres,
}: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'taches' | 'equipe'>('taches')
  const [taches, setTaches] = useState<TacheWithUser[]>(initialTaches)
  const [affectations] = useState<AffectationWithUser[]>(initialAffectations)
  const [showAffectationForm, setShowAffectationForm] = useState(false)

  // Mise à jour statut tâche via PATCH /api/taches/[id]
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
      {/* Tabs */}
      <div className="flex gap-2 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('taches')}
          className={`border-2 border-black rounded-[6px] font-heading font-semibold px-4 py-1.5 text-sm cursor-pointer transition-all ${
            activeTab === 'taches' ? 'bg-accent text-white' : 'bg-white text-black'
          }`}
        >
          Tâches ({taches.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('equipe')}
          className={`border-2 border-black rounded-[6px] font-heading font-semibold px-4 py-1.5 text-sm cursor-pointer transition-all ${
            activeTab === 'equipe' ? 'bg-accent text-white' : 'bg-white text-black'
          }`}
        >
          Équipe ({affectations.length})
        </button>
      </div>

      {/* Tab Tâches */}
      {activeTab === 'taches' && (
        <main className="px-4 pt-2 pb-40 flex flex-col gap-3">
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
            <Link
              href={`/conducteur/chantiers/${chantierId}/taches/nouvelle`}
              className="btn-brutal bg-accent text-white px-4 py-3 flex items-center justify-center gap-2 w-full text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Ajouter une tâche
            </Link>

            <button
              type="button"
              onClick={() => setShowAffectationForm(true)}
              className="btn-brutal bg-primary-dark text-white px-4 py-3 flex items-center justify-center gap-2 w-full text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
              Affecter un membre
            </button>
          </div>
        </main>
      )}

      {/* Tab Équipe */}
      {activeTab === 'equipe' && (
        <div className="px-4 pt-2 pb-40 flex flex-col gap-3">
          {affectations.length === 0 ? (
            <div className="card-brutal-mobile p-6 text-center mt-2">
              <p className="font-heading font-bold text-base mb-1">Aucun membre affecté</p>
              <p className="text-xs text-muted">Affectez des membres à ce chantier.</p>
            </div>
          ) : (
            affectations.map((aff) => (
              <div key={aff.id} className="card-brutal-mobile p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-surface border-2 border-black flex items-center justify-center font-bold text-sm shrink-0">
                  {aff.user?.prenom?.[0] ?? '?'}{aff.user?.nom?.[0] ?? ''}
                </div>
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
              </div>
            ))
          )}

          <button
            type="button"
            onClick={() => setShowAffectationForm(true)}
            className="btn-brutal bg-accent text-white px-4 py-3 flex items-center justify-center gap-2 w-full text-sm mt-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Affecter un membre
          </button>
        </div>
      )}

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
