'use client'
// app/(admin)/chantiers/[id]/modifier/client.tsx
// Client Component du formulaire de modification chantier (Sprint 2 dette 2026-05-20).
// Miroir de /nouveau/page.tsx mais avec valeurs initiales pré-remplies et PATCH au lieu de POST.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Chantier } from '@/types/database'

interface Props {
  chantier: Chantier
}

export function ModifierChantierClient({ chantier }: Props) {
  const router = useRouter()

  const [form, setForm] = useState({
    nom: chantier.nom,
    client_nom: chantier.client_nom,
    adresse: chantier.adresse,
    code_postal: chantier.code_postal,
    budget_alloue: chantier.budget_alloue !== null ? String(chantier.budget_alloue) : '',
    budget_depense: String(chantier.budget_depense),
    date_debut: chantier.date_debut,
    date_fin_prevue: chantier.date_fin_prevue,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  function validate(): boolean {
    const newErrors: Record<string, string> = {}

    if (!form.nom.trim()) newErrors['nom'] = 'Le nom du chantier est requis.'
    if (form.nom.length > 100) newErrors['nom'] = 'Max 100 caractères.'

    if (!form.client_nom.trim()) newErrors['client_nom'] = 'Le nom du client est requis.'
    if (!form.adresse.trim()) newErrors['adresse'] = "L'adresse est requise."

    if (!form.code_postal.trim()) {
      newErrors['code_postal'] = 'Le code postal est requis.'
    } else if (!/^\d{5}$/.test(form.code_postal)) {
      newErrors['code_postal'] = 'Code postal : 5 chiffres requis'
    }

    const budgetAlloueNum = form.budget_alloue ? Number(form.budget_alloue.replace(/\s/g, '')) : null
    if (form.budget_alloue && Number.isNaN(budgetAlloueNum)) {
      newErrors['budget_alloue'] = 'Budget invalide.'
    } else if (budgetAlloueNum !== null && budgetAlloueNum <= 0) {
      newErrors['budget_alloue'] = 'Le budget doit être positif.'
    }

    const budgetDepenseNum = form.budget_depense ? Number(form.budget_depense.replace(/\s/g, '')) : 0
    if (form.budget_depense && Number.isNaN(budgetDepenseNum)) {
      newErrors['budget_depense'] = 'Montant invalide.'
    } else if (budgetDepenseNum < 0) {
      newErrors['budget_depense'] = 'Le montant dépensé ne peut pas être négatif.'
    }

    if (!form.date_debut) newErrors['date_debut'] = 'La date de début est requise.'
    if (!form.date_fin_prevue) newErrors['date_fin_prevue'] = 'La date de fin prévue est requise.'
    if (form.date_debut && form.date_fin_prevue && form.date_fin_prevue < form.date_debut) {
      newErrors['date_fin_prevue'] = 'La date de fin prévue doit être >= à la date de début.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGlobalError(null)
    setSuccessMessage(null)

    if (!validate()) return
    setIsLoading(true)

    const budgetAlloueNum = form.budget_alloue ? Number(form.budget_alloue.replace(/\s/g, '')) : null
    const budgetDepenseNum = form.budget_depense ? Number(form.budget_depense.replace(/\s/g, '')) : 0

    // PATCH n'envoie que les champs effectivement modifiés (le schéma serveur les a tous optional).
    // Comparer chaque champ à la valeur initiale du chantier — payload minimal = log clairer côté serveur.
    const payload: Record<string, string | number | null> = {}
    if (form.nom !== chantier.nom) payload['nom'] = form.nom
    if (form.client_nom !== chantier.client_nom) payload['client_nom'] = form.client_nom
    if (form.adresse !== chantier.adresse) payload['adresse'] = form.adresse
    if (form.code_postal !== chantier.code_postal) payload['code_postal'] = form.code_postal
    if (budgetAlloueNum !== chantier.budget_alloue) {
      // budget_alloue peut être null — UpdateChantierSchema l'accepte comme nombre positif.
      // Si on veut le clear (passer de valeur à null), le schéma actuel ne le permet pas.
      // Pour Sprint 2, on autorise uniquement set/update sur valeur positive.
      if (budgetAlloueNum !== null && budgetAlloueNum > 0) {
        payload['budget_alloue'] = budgetAlloueNum
      }
    }
    if (budgetDepenseNum !== chantier.budget_depense) payload['budget_depense'] = budgetDepenseNum
    if (form.date_debut !== chantier.date_debut) payload['date_debut'] = form.date_debut
    if (form.date_fin_prevue !== chantier.date_fin_prevue) payload['date_fin_prevue'] = form.date_fin_prevue

    if (Object.keys(payload).length === 0) {
      setGlobalError('Aucune modification à enregistrer.')
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/chantiers/${chantier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.status === 402) {
        setGlobalError("Votre essai a expiré — passez en payant pour modifier ce chantier.")
        return
      }

      if (response.status === 400) {
        const data = (await response.json()) as { error?: string; fields?: Record<string, string[]> }
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

      setSuccessMessage('Chantier mis à jour avec succès.')
      setTimeout(() => {
        router.push(`/admin/chantiers/${chantier.id}`)
        router.refresh()
      }, 600)
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
    <div>
      <div className="mb-6">
        <Link
          href={`/admin/chantiers/${chantier.id}`}
          className="text-xs text-muted flex items-center gap-1 mb-3 hover:text-primary transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Retour au chantier
        </Link>
        <h1 className="font-heading font-bold text-[28px]">Modifier le chantier</h1>
        <p className="text-muted mt-1">{chantier.nom}</p>
      </div>

      {successMessage && (
        <div className="card-brutal p-4 border-l-4 border-l-success bg-success-bg mb-6">
          <p className="text-success font-semibold">{successMessage}</p>
        </div>
      )}

      {globalError && (
        <div className="card-brutal p-4 border-l-4 border-l-danger bg-danger-bg mb-6">
          <p className="text-danger font-semibold">{globalError}</p>
        </div>
      )}

      <div className="card-brutal p-8 max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="nom" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
              Nom du chantier <span className="text-danger">*</span>
            </label>
            <input
              id="nom"
              type="text"
              value={form.nom}
              onChange={(e) => handleChange('nom', e.target.value)}
              className={`input-brutal ${errors['nom'] ? 'error' : ''}`}
              maxLength={100}
              required
            />
            {errors['nom'] && <p className="text-danger text-sm font-medium mt-1">{errors['nom']}</p>}
          </div>

          <div>
            <label htmlFor="client_nom" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
              Client <span className="text-danger">*</span>
            </label>
            <input
              id="client_nom"
              type="text"
              value={form.client_nom}
              onChange={(e) => handleChange('client_nom', e.target.value)}
              className={`input-brutal ${errors['client_nom'] ? 'error' : ''}`}
              maxLength={200}
              required
            />
            {errors['client_nom'] && <p className="text-danger text-sm font-medium mt-1">{errors['client_nom']}</p>}
          </div>

          <div>
            <label htmlFor="adresse" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
              Adresse <span className="text-danger">*</span>
            </label>
            <input
              id="adresse"
              type="text"
              value={form.adresse}
              onChange={(e) => handleChange('adresse', e.target.value)}
              className={`input-brutal ${errors['adresse'] ? 'error' : ''}`}
              required
            />
            {errors['adresse'] && <p className="text-danger text-sm font-medium mt-1">{errors['adresse']}</p>}
          </div>

          <div>
            <label htmlFor="code_postal" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
              Code postal <span className="text-danger">*</span>
            </label>
            <input
              id="code_postal"
              type="text"
              value={form.code_postal}
              onChange={(e) => handleChange('code_postal', e.target.value)}
              className={`input-brutal ${errors['code_postal'] ? 'error' : ''}`}
              maxLength={5}
              pattern="\d{5}"
              required
            />
            {errors['code_postal'] && <p className="text-danger text-sm font-medium mt-1">{errors['code_postal']}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="budget_alloue" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
                Budget alloué (€) <span className="text-muted font-normal normal-case">(optionnel)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-bold text-lg">€</span>
                <input
                  id="budget_alloue"
                  type="text"
                  inputMode="numeric"
                  value={form.budget_alloue}
                  onChange={(e) => handleChange('budget_alloue', e.target.value)}
                  placeholder="65 000"
                  className={`input-brutal pl-8 ${errors['budget_alloue'] ? 'error' : ''}`}
                />
              </div>
              {errors['budget_alloue'] && <p className="text-danger text-sm font-medium mt-1">{errors['budget_alloue']}</p>}
            </div>

            <div>
              <label htmlFor="budget_depense" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
                Budget dépensé (€)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-bold text-lg">€</span>
                <input
                  id="budget_depense"
                  type="text"
                  inputMode="numeric"
                  value={form.budget_depense}
                  onChange={(e) => handleChange('budget_depense', e.target.value)}
                  placeholder="0"
                  className={`input-brutal pl-8 ${errors['budget_depense'] ? 'error' : ''}`}
                />
              </div>
              {errors['budget_depense'] && <p className="text-danger text-sm font-medium mt-1">{errors['budget_depense']}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="date_debut" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
                Date début <span className="text-danger">*</span>
              </label>
              <input
                id="date_debut"
                type="date"
                value={form.date_debut}
                onChange={(e) => handleChange('date_debut', e.target.value)}
                className={`input-brutal ${errors['date_debut'] ? 'error' : ''}`}
                required
              />
              {errors['date_debut'] && <p className="text-danger text-sm font-medium mt-1">{errors['date_debut']}</p>}
            </div>
            <div>
              <label htmlFor="date_fin_prevue" className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide">
                Date fin prévue <span className="text-danger">*</span>
              </label>
              <input
                id="date_fin_prevue"
                type="date"
                value={form.date_fin_prevue}
                onChange={(e) => handleChange('date_fin_prevue', e.target.value)}
                min={form.date_debut || undefined}
                className={`input-brutal ${errors['date_fin_prevue'] ? 'error' : ''}`}
                required
              />
              {errors['date_fin_prevue'] && <p className="text-danger text-sm font-medium mt-1">{errors['date_fin_prevue']}</p>}
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={isLoading}
              className="btn-brutal bg-accent text-white"
              data-testid="modifier-chantier-submit"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enregistrement...
                </span>
              ) : (
                'Enregistrer les modifications'
              )}
            </button>
            <Link href={`/admin/chantiers/${chantier.id}`} className="btn-brutal bg-white text-primary">
              Annuler
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
