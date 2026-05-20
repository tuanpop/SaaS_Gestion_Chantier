'use client'
// components/TacheCreateModal.tsx
// Modal de création tâche réutilisable (admin + autres contextes desktop)
//
// Bug 2 extension (Sprint 2 dette — 2026-05-20) :
//   "Admin peut tout faire" — l'admin doit pouvoir créer une tâche.
//   La page conducteur /conducteur/.../taches/nouvelle est mobile-first (bottom-nav),
//   incompatible avec le namespace admin (sidebar desktop). Plutôt que dupliquer
//   la page, on encapsule la création dans une modal pattern AffectationForm.
//
// L'API POST /api/chantiers/[id]/taches accepte déjà role=admin (voir route.ts).
// Le composant n'a aucune logique de rôle — il poste ce qu'on lui donne.

import { useState } from 'react'
import type { TacheStatut } from '@/types/database'

// ============================================================
// Types
// ============================================================

export interface TacheCreateModalMember {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface TacheCreateModalProps {
  chantierId: string
  membres: TacheCreateModalMember[]
  onSuccess: () => void
  onClose: () => void
}

const STATUTS: { value: TacheStatut; label: string }[] = [
  { value: 'a_faire', label: 'À faire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' },
]

// ============================================================
// Composant
// ============================================================

export function TacheCreateModal({
  chantierId,
  membres,
  onSuccess,
  onClose,
}: TacheCreateModalProps) {
  const [form, setForm] = useState({
    titre: '',
    description: '',
    date_echeance: '',
    statut: 'a_faire' as TacheStatut,
    bloque_raison: '',
    assigned_to: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  function validate(): boolean {
    const newErrors: Record<string, string> = {}

    if (!form.titre.trim()) {
      newErrors['titre'] = 'Le titre est requis.'
    } else if (form.titre.length > 200) {
      newErrors['titre'] = 'Max 200 caractères.'
    }

    if (form.description.length > 2000) {
      newErrors['description'] = 'Max 2000 caractères.'
    }

    if (form.statut === 'bloque') {
      if (!form.bloque_raison.trim() || form.bloque_raison.length < 10) {
        newErrors['bloque_raison'] = 'Raison obligatoire si tâche bloquée (min 10 caractères).'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGlobalError(null)

    if (!validate()) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/chantiers/${chantierId}/taches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titre: form.titre,
          ...(form.description ? { description: form.description } : {}),
          ...(form.date_echeance ? { date_echeance: form.date_echeance } : {}),
          statut: form.statut,
          ...(form.statut === 'bloque' ? { bloque_raison: form.bloque_raison } : {}),
          ...(form.assigned_to ? { assigned_to: form.assigned_to } : {}),
        }),
      })

      if (response.status === 402) {
        setGlobalError("Votre essai a expiré — passez en payant pour créer des tâches.")
        return
      }

      if (response.status === 400) {
        const data = await response.json() as { error?: string; fields?: Record<string, string[]> }
        if (data.fields) {
          const fieldErrors: Record<string, string> = {}
          for (const [field, messages] of Object.entries(data.fields)) {
            fieldErrors[field] = messages[0] ?? 'Champ invalide.'
          }
          setErrors(fieldErrors)
        } else {
          setGlobalError(data.error ?? 'Requête invalide.')
        }
        return
      }

      if (!response.ok) {
        setGlobalError('Une erreur est survenue. Réessayez.')
        return
      }

      onSuccess()
    } catch {
      setGlobalError('Erreur réseau. Vérifiez votre connexion.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleChange(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card-brutal p-6 w-full max-w-lg bg-cream max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading font-bold text-[22px]">Nouvelle tâche</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-black transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {globalError && (
          <div className="bg-danger-bg border border-danger rounded p-3 mb-4">
            <p className="text-danger text-sm font-medium">{globalError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Titre */}
          <div>
            <label
              htmlFor="tache-titre"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Titre <span className="text-danger">*</span>
            </label>
            <input
              id="tache-titre"
              type="text"
              value={form.titre}
              onChange={(e) => handleChange('titre', e.target.value)}
              placeholder="Ex : Pose carrelage RDC"
              className={`input-brutal ${errors['titre'] ? 'error' : ''}`}
              maxLength={200}
              required
            />
            {errors['titre'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['titre']}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="tache-description"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Description <span className="text-muted font-normal normal-case">(optionnel)</span>
            </label>
            <textarea
              id="tache-description"
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Détails de la tâche..."
              className={`input-brutal resize-none h-24 ${errors['description'] ? 'error' : ''}`}
              maxLength={2000}
            />
            {errors['description'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['description']}</p>
            )}
          </div>

          {/* Date échéance */}
          <div>
            <label
              htmlFor="tache-date-echeance"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Date d&apos;échéance <span className="text-muted font-normal normal-case">(optionnel)</span>
            </label>
            <input
              id="tache-date-echeance"
              type="date"
              value={form.date_echeance}
              onChange={(e) => handleChange('date_echeance', e.target.value)}
              className="input-brutal"
            />
          </div>

          {/* Assigner à */}
          <div>
            <label
              htmlFor="tache-assigned-to"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Assigner à <span className="text-muted font-normal normal-case">(optionnel)</span>
            </label>
            <select
              id="tache-assigned-to"
              data-testid="admin-tache-assigned-to"
              value={form.assigned_to}
              onChange={(e) => handleChange('assigned_to', e.target.value)}
              className="input-brutal"
            >
              <option value="">— Non assignée —</option>
              {membres.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.prenom} {m.nom} ({m.role === 'ouvrier' ? 'Ouvrier' : 'Conducteur'})
                </option>
              ))}
            </select>
          </div>

          {/* Statut */}
          <div>
            <label className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
              Statut initial
            </label>
            <div className="flex gap-2 flex-wrap">
              {STATUTS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    handleChange('statut', value)
                    if (value !== 'bloque') {
                      handleChange('bloque_raison', '')
                    }
                  }}
                  className={`btn-brutal text-sm py-2 px-4 ${
                    form.statut === value
                      ? 'bg-accent text-white'
                      : 'bg-white text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Raison blocage — conditionnel */}
          {form.statut === 'bloque' && (
            <div>
              <label
                htmlFor="tache-bloque-raison"
                className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
              >
                Raison du blocage <span className="text-danger">*</span>
              </label>
              <textarea
                id="tache-bloque-raison"
                value={form.bloque_raison}
                onChange={(e) => handleChange('bloque_raison', e.target.value)}
                placeholder="Décrivez la raison du blocage (min. 10 caractères)"
                className={`input-brutal resize-none h-24 ${errors['bloque_raison'] ? 'error' : ''}`}
                minLength={10}
              />
              {errors['bloque_raison'] && (
                <p className="text-danger text-sm font-medium mt-1">{errors['bloque_raison']}</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="btn-brutal bg-accent text-white flex-1 justify-center disabled:opacity-50"
            >
              {isLoading ? 'Création...' : 'Créer la tâche'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="btn-brutal bg-white text-primary"
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
