'use client'
// app/(conducteur)/chantiers/[id]/taches/nouvelle/page.tsx
// Formulaire création tâche (conducteur) — mobile-first
// Client Component pour les interactions formulaire
//
// Proto référencé : mockups/10-conducteur-taches.html
// Design system Hana : mobile-first 390px, input-brutal, btn-brutal, touch target 56px
//
// Champs :
//   - Titre (required)
//   - Description (textarea, optionnel)
//   - Date échéance (date picker, optionnel)
//   - Statut initial (défaut : a_faire)
//   - Si statut = bloque : champ raison (obligatoire, min 10 car.) — conditionnel
//
// Note : "Assigner à" n'est pas dans ce formulaire (Sprint 3 feature — QR scan)
// L'assignation peut être faite via PATCH /api/taches/[id] après création

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import type { TacheStatut } from '@/types/database'

const STATUTS: { value: TacheStatut; label: string }[] = [
  { value: 'a_faire', label: 'À faire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' },
]

export default function NouvelleTachePage() {
  const router = useRouter()
  const { id: chantierId } = useParams() as { id: string }

  const [form, setForm] = useState({
    titre: '',
    description: '',
    date_echeance: '',
    statut: 'a_faire' as TacheStatut,
    bloque_raison: '',
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
      if (!form.bloque_raison.trim()) {
        newErrors['bloque_raison'] = 'La raison est obligatoire si la tâche est bloquée.'
      } else if (form.bloque_raison.length < 10) {
        newErrors['bloque_raison'] = 'Raison obligatoire si tâche bloquée (min 10 caractères)'
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
        setGlobalError("Une erreur est survenue. Réessayez.")
        return
      }

      // Succès — retour au détail chantier
      router.push(`/conducteur/chantiers/${chantierId}`)
    } catch {
      setGlobalError('Erreur réseau. Vérifiez votre connexion.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleChange(field: string, value: string) {
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
    <>
      {/* Header */}
      <header className="bg-primary-dark px-4 py-4">
        <Link
          href={`/conducteur/chantiers/${chantierId}`}
          className="text-white/70 text-xs flex items-center gap-1 mb-1"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Retour
        </Link>
        <h1 className="font-heading text-white text-lg font-bold">Nouvelle tâche</h1>
      </header>

      <main className="px-4 pt-4 pb-40">
        {/* Erreur globale */}
        {globalError && (
          <div className="card-brutal-mobile p-4 border-l-4 border-l-danger bg-danger-bg mb-4">
            <p className="text-danger font-semibold text-sm">{globalError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Titre */}
          <div>
            <label
              htmlFor="titre"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Titre <span className="text-danger">*</span>
            </label>
            <input
              id="titre"
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
              htmlFor="description"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Description <span className="text-muted font-normal normal-case">(optionnel)</span>
            </label>
            <textarea
              id="description"
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
              htmlFor="date_echeance"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Date d&apos;échéance <span className="text-muted font-normal normal-case">(optionnel)</span>
            </label>
            <input
              id="date_echeance"
              type="date"
              value={form.date_echeance}
              onChange={(e) => handleChange('date_echeance', e.target.value)}
              className="input-brutal"
            />
          </div>

          {/* Statut initial */}
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
                    // Effacer raison si on quitte "bloque"
                    if (value !== 'bloque') {
                      handleChange('bloque_raison', '')
                    }
                  }}
                  className={`px-3 py-2 border-2 rounded-[6px] text-sm font-semibold transition-all ${
                    form.statut === value
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black'
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
                htmlFor="bloque_raison"
                className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
              >
                Raison du blocage <span className="text-danger">*</span>
              </label>
              <textarea
                id="bloque_raison"
                value={form.bloque_raison}
                onChange={(e) => handleChange('bloque_raison', e.target.value)}
                placeholder="Décrivez la raison du blocage (min. 10 caractères)"
                className={`input-brutal resize-none h-24 ${errors['bloque_raison'] ? 'error' : ''}`}
                minLength={10}
              />
              {form.bloque_raison.length > 0 && form.bloque_raison.length < 10 && (
                <p className="text-danger text-xs mt-1 font-medium">
                  Raison obligatoire si tâche bloquée (min 10 caractères) — {form.bloque_raison.length}/10
                </p>
              )}
              {errors['bloque_raison'] && (
                <p className="text-danger text-sm font-medium mt-1">{errors['bloque_raison']}</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-4">
            <button
              type="submit"
              disabled={isLoading}
              className="btn-brutal btn-brutal-mobile bg-accent text-white w-full justify-center disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Création...
                </span>
              ) : (
                'Créer la tâche'
              )}
            </button>
            <Link
              href={`/conducteur/chantiers/${chantierId}`}
              className="btn-brutal btn-brutal-mobile bg-white text-primary w-full text-center"
            >
              Annuler
            </Link>
          </div>
        </form>
      </main>
    </>
  )
}
