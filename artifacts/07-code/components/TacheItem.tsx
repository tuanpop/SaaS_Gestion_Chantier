'use client'
// components/TacheItem.tsx — migré Badge + Button + Textarea shadcn (étape 7, C-02)
//
// RG-REACH-004 : motif blocage visible côté conducteur
// Mode édition inline conducteur préservé (onUpdate = conducteur uniquement)

import { useState } from 'react'
import type { Tache, TacheStatut } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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

const STATUT_STYLES: Record<TacheStatut, {
  variant: 'muted' | 'primary' | 'success' | 'danger'
  label: string
}> = {
  a_faire: { variant: 'muted', label: 'À faire' },
  en_cours: { variant: 'primary', label: 'En cours' },
  termine:  { variant: 'success', label: 'Terminée' },
  bloque:   { variant: 'danger', label: 'Bloquée' },
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
    <div className={`card-brutal p-4 ${isBloque ? 'bg-danger-bg' : 'bg-white'}`}>
      {/* Header : titre + badge statut */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="font-semibold text-sm flex-1">{tache.titre}</p>
        <Badge variant={statutStyle.variant} className="shrink-0 text-xs">
          {statutStyle.label}
        </Badge>
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

      {/* RG-REACH-004 : Raison de blocage — visible côté conducteur */}
      {isBloque && tache.bloque_raison && (
        <div className="bg-danger-bg border-2 border-danger rounded-[6px] p-2 mb-2">
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
              {(Object.entries(STATUT_STYLES) as [TacheStatut, typeof STATUT_STYLES[TacheStatut]][]).map(
                ([statut, style]) => (
                  <Button
                    key={statut}
                    type="button"
                    onClick={() => setSelectedStatut(statut)}
                    variant={selectedStatut === statut ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs"
                  >
                    {style.label}
                  </Button>
                ),
              )}
            </div>
          </div>

          {/* Raison blocage */}
          {selectedStatut === 'bloque' && (
            <div>
              <label className="block font-heading font-semibold text-xs uppercase text-muted mb-1 tracking-wide">
                Raison du blocage <span className="text-danger">*</span>
              </label>
              <Textarea
                value={bloqueRaison}
                onChange={(e) => setBloqueRaison(e.target.value)}
                className="resize-none h-20"
                placeholder="Décrivez la raison du blocage (min. 10 caractères)"
                minLength={10}
                aria-invalid={bloqueRaison.length > 0 && bloqueRaison.length < 10}
              />
              {bloqueRaison.length > 0 && bloqueRaison.length < 10 && (
                <p role="alert" className="text-danger text-xs mt-1 font-medium">
                  Raison obligatoire si tâche bloquée (min 10 caractères) — {bloqueRaison.length}/10
                </p>
              )}
            </div>
          )}

          {/* Erreur */}
          {error && (
            <p role="alert" className="text-danger text-xs font-medium">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {/* K2.5-D-06 : Button disabled={isLoading} */}
            <Button
              type="button"
              onClick={handleSave}
              disabled={isLoading || (selectedStatut === 'bloque' && bloqueRaison.length < 10)}
              size="sm"
            >
              {isLoading ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsEditing(false)
                setError(null)
                setSelectedStatut(tache.statut)
                setBloqueRaison(tache.bloque_raison ?? '')
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Bouton modifier (conducteur, hors mode édition) */}
      {!isReadOnly && !isEditing && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="text-xs text-primary font-semibold mt-1 border-transparent"
        >
          Modifier le statut
        </Button>
      )}
    </div>
  )
}
