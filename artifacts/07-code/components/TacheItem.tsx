'use client'
// components/TacheItem.tsx
// Item tâche — statut badge, assigné, raison blocage
// Réutilisé dans : app/(admin)/chantiers/[id]/page.tsx + app/(conducteur)/chantiers/[id]/page.tsx
//
// Proto référencé :
//   Admin desktop : mockups/16-admin-chantier-detail.html (tableau tâches lignes 206-255)
//   Conducteur mobile : mockups/09-conducteur-chantier-detail.html
//   Tâche bloquée : badge-danger + texte bloque_raison en rouge
//
// Design system Hana :
//   Badge statut : a_faire (gris), en_cours (bleu), termine (vert), bloque (rouge)
//   Si bloque : bloque_raison visible en rouge (--color-danger)
//   onUpdate=undefined -> lecture seule (admin)
//   onUpdate={fn} -> conducteur peut modifier le statut

import { useState } from 'react'
import type { Tache, TacheStatut } from '@/types/database'

// ============================================================
// Types
// ============================================================

interface AssignedUser {
  nom: string
  prenom: string
}

interface TacheItemProps {
  tache: Tache & { assigned_user?: AssignedUser | null }
  onUpdate?: (patch: Partial<Pick<Tache, 'statut' | 'bloque_raison'>>) => Promise<void>
}

// ============================================================
// Helpers
// ============================================================

const STATUT_STYLES: Record<TacheStatut, { badgeClass: string; label: string }> = {
  a_faire: { badgeClass: 'badge badge-muted', label: 'À faire' },
  en_cours: { badgeClass: 'badge badge-primary', label: 'En cours' },
  termine:  { badgeClass: 'badge badge-success', label: 'Terminée' },
  bloque:   { badgeClass: 'badge badge-danger', label: 'Bloquée' },
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

// ============================================================
// TacheItem
// ============================================================

export function TacheItem({ tache, onUpdate }: TacheItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [selectedStatut, setSelectedStatut] = useState<TacheStatut>(tache.statut)
  const [bloqueRaison, setBloqueRaison] = useState(tache.bloque_raison ?? '')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const statutStyle = STATUT_STYLES[tache.statut]
  const assignedName = tache.assigned_user
    ? `${tache.assigned_user.prenom} ${tache.assigned_user.nom}`
    : 'Non assigné'
  const dateEcheance = formatDate(tache.date_echeance)
  const isBloque = tache.statut === 'bloque'
  const isReadOnly = !onUpdate

  async function handleSave() {
    if (!onUpdate) return
    if (selectedStatut === 'bloque' && bloqueRaison.length < 10) {
      setError('La raison de blocage doit faire au moins 10 caractères.')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      await onUpdate({
        statut: selectedStatut,
        ...(selectedStatut === 'bloque' ? { bloque_raison: bloqueRaison } : {}),
      })
      setIsEditing(false)
    } catch {
      setError('Une erreur est survenue. Réessayez.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className={`card-brutal p-4 ${isBloque ? 'bg-danger-bg' : 'bg-white'}`}
    >
      {/* Header : titre + badge statut */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="font-semibold text-sm flex-1">{tache.titre}</p>
        <span className={`${statutStyle.badgeClass} shrink-0 text-xs`}>
          {statutStyle.label}
        </span>
      </div>

      {/* Assigné + date échéance */}
      <div className="flex items-center gap-4 text-xs text-muted mb-2">
        <span>{assignedName}</span>
        {dateEcheance && (
          <span className={isBloque ? 'text-danger font-semibold' : ''}>
            Échéance : {dateEcheance}
          </span>
        )}
      </div>

      {/* Description si présente */}
      {tache.description && (
        <p className="text-xs text-muted mb-2">{tache.description}</p>
      )}

      {/* Raison de blocage */}
      {isBloque && tache.bloque_raison && (
        <div className="bg-danger-bg border border-danger rounded p-2 mb-2">
          <p className="text-danger text-xs font-semibold">
            Raison du blocage : {tache.bloque_raison}
          </p>
        </div>
      )}

      {/* Formulaire inline de modification (conducteur uniquement) */}
      {!isReadOnly && isEditing && (
        <div className="border-t border-black pt-3 mt-2 space-y-3">
          {/* Sélecteur de statut */}
          <div>
            <label className="block font-heading font-semibold text-xs uppercase text-muted mb-1 tracking-wide">
              Nouveau statut
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(STATUT_STYLES) as [TacheStatut, { badgeClass: string; label: string }][]).map(
                ([statut, style]) => (
                  <button
                    key={statut}
                    type="button"
                    onClick={() => setSelectedStatut(statut)}
                    className={`px-3 py-1 border-2 rounded text-xs font-semibold transition-all ${
                      selectedStatut === statut
                        ? 'border-black bg-black text-white'
                        : 'border-black bg-white text-black'
                    }`}
                  >
                    {style.label}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Raison blocage — apparaît conditionnellement */}
          {selectedStatut === 'bloque' && (
            <div>
              <label className="block font-heading font-semibold text-xs uppercase text-muted mb-1 tracking-wide">
                Raison du blocage <span className="text-danger">*</span>
              </label>
              <textarea
                value={bloqueRaison}
                onChange={(e) => setBloqueRaison(e.target.value)}
                className={`input-brutal resize-none h-20 ${
                  bloqueRaison.length > 0 && bloqueRaison.length < 10 ? 'error' : ''
                }`}
                placeholder="Décrivez la raison du blocage (min. 10 caractères)"
                minLength={10}
              />
              {bloqueRaison.length > 0 && bloqueRaison.length < 10 && (
                <p className="text-danger text-xs mt-1 font-medium">
                  Raison obligatoire si tâche bloquée (min 10 caractères) — {bloqueRaison.length}/10
                </p>
              )}
            </div>
          )}

          {/* Erreur */}
          {error && (
            <p className="text-danger text-xs font-medium">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || (selectedStatut === 'bloque' && bloqueRaison.length < 10)}
              className="btn-brutal bg-accent text-white text-sm py-2 px-4 disabled:opacity-50"
            >
              {isLoading ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false)
                setError(null)
                setSelectedStatut(tache.statut)
                setBloqueRaison(tache.bloque_raison ?? '')
              }}
              className="btn-brutal bg-white text-primary text-sm py-2 px-4"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Bouton modifier (conducteur, hors mode édition) */}
      {!isReadOnly && !isEditing && (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-xs text-primary font-semibold hover:underline mt-1 flex items-center gap-1"
        >
          Modifier le statut
        </button>
      )}
    </div>
  )
}
