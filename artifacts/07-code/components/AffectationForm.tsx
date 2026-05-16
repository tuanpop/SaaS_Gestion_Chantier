'use client'
// components/AffectationForm.tsx
// Formulaire affectation ouvrier/conducteur au chantier
// Utilisé dans : app/(conducteur)/chantiers/[id]/page.tsx + app/(admin)/chantiers/[id]/page.tsx
//
// Proto référencé : mockups/09-conducteur-chantier-detail.html
// Design system Hana : modal avec card-brutal, input-brutal, btn-brutal
// Q2 (2026-05-15) : liste ouvriers ET conducteurs (pas seulement ouvriers)

import { useState } from 'react'

// ============================================================
// Types
// ============================================================

interface OuvrierOption {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface AffectationFormProps {
  chantierId: string
  ouvriers: OuvrierOption[]
  onSuccess: () => void
  onClose: () => void
}

// ============================================================
// AffectationForm
// ============================================================

export function AffectationForm({
  chantierId,
  ouvriers,
  onSuccess,
  onClose,
}: AffectationFormProps) {
  const [userId, setUserId] = useState('')
  const [dateDebut, setDateDebut] = useState(new Date().toISOString().split('T')[0] ?? '')
  const [dateFin, setDateFin] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0] ?? ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) {
      setError('Veuillez sélectionner un membre de l\'équipe.')
      return
    }
    if (!dateDebut) {
      setError('La date de début est obligatoire.')
      return
    }
    if (dateFin && dateFin < dateDebut) {
      setError('La date de fin doit être >= à la date de début.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/chantiers/${chantierId}/affectations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          date_debut: dateDebut,
          ...(dateFin ? { date_fin: dateFin } : {}),
          vue: 'mes_taches',
        }),
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        setError(data.error ?? 'Une erreur est survenue.')
        return
      }

      onSuccess()
    } catch {
      setError('Erreur réseau. Réessayez.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    // Overlay
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="card-brutal p-6 w-full max-w-md bg-cream">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading font-bold text-[22px]">Affecter un membre</h2>
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

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Sélection membre */}
          <div>
            <label
              htmlFor="aff-user"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Membre de l&apos;équipe <span className="text-danger">*</span>
            </label>
            {ouvriers.length === 0 ? (
              <p className="text-muted text-sm">Aucun membre disponible dans l&apos;équipe.</p>
            ) : (
              <select
                id="aff-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="input-brutal"
                required
              >
                <option value="">-- Choisir un membre --</option>
                {ouvriers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.prenom} {o.nom}
                    {o.role === 'conducteur' ? ' (conducteur)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Date de début */}
          <div>
            <label
              htmlFor="aff-debut"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Date de début <span className="text-danger">*</span>
            </label>
            <input
              id="aff-debut"
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              min={today}
              className="input-brutal"
              required
            />
          </div>

          {/* Date de fin (optionnelle) */}
          <div>
            <label
              htmlFor="aff-fin"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Date de fin <span className="text-muted font-normal">(optionnel)</span>
            </label>
            <input
              id="aff-fin"
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              min={dateDebut || today}
              className="input-brutal"
            />
          </div>

          {/* Erreur */}
          {error && (
            <div className="bg-danger-bg border border-danger rounded p-3">
              <p className="text-danger text-sm font-medium">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isLoading || !userId || !dateDebut}
              className="btn-brutal bg-accent text-white flex-1 justify-center disabled:opacity-50"
            >
              {isLoading ? 'Affectation...' : 'Affecter'}
            </button>
            <button
              type="button"
              onClick={onClose}
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
