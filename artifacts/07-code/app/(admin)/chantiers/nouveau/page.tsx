'use client'
// app/(admin)/chantiers/nouveau/page.tsx
// Formulaire création chantier (admin)
// Client Component — 'use client' pour react-hook-form + useRouter
//
// Proto référencé : mockups/17-admin-chantier-nouveau.html
// Design system Hana : card-brutal, input-brutal, btn-brutal
//   - Validation inline code_postal (US-010 S2)
//   - Toast succès + redirect vers /admin/chantiers/[id]
//   - Toast erreur 402 : "Votre essai a expiré"
//   - Bouton loading state (disabled + texte "Création...")

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NouveauChantierPage() {
  const router = useRouter()

  const [form, setForm] = useState({
    nom: '',
    client_nom: '',
    adresse: '',
    code_postal: '',
    budget_alloue: '',
    date_debut: '',
    date_fin_prevue: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // ============================================================
  // Validation client-side (miroir Zod serveur)
  // ============================================================

  function validate(): boolean {
    const newErrors: Record<string, string> = {}

    if (!form.nom.trim()) newErrors['nom'] = 'Le nom du chantier est requis.'
    if (form.nom.length > 100) newErrors['nom'] = 'Max 100 caractères.'

    if (!form.client_nom.trim()) newErrors['client_nom'] = 'Le nom du client est requis.'

    if (!form.adresse.trim()) newErrors['adresse'] = "L'adresse est requise."

    // US-010 S2 : validation regex code postal 5 chiffres
    if (!form.code_postal.trim()) {
      newErrors['code_postal'] = 'Le code postal est requis.'
    } else if (!/^\d{5}$/.test(form.code_postal)) {
      newErrors['code_postal'] = 'Code postal : 5 chiffres requis'
    }

    if (form.budget_alloue && isNaN(Number(form.budget_alloue.replace(/\s/g, '')))) {
      newErrors['budget_alloue'] = 'Budget invalide.'
    }
    if (form.budget_alloue && Number(form.budget_alloue.replace(/\s/g, '')) <= 0) {
      newErrors['budget_alloue'] = 'Le budget doit être positif.'
    }

    if (!form.date_debut) newErrors['date_debut'] = 'La date de début est requise.'
    if (!form.date_fin_prevue) newErrors['date_fin_prevue'] = 'La date de fin prévue est requise.'

    if (form.date_debut && form.date_fin_prevue && form.date_fin_prevue < form.date_debut) {
      newErrors['date_fin_prevue'] = 'La date de fin prévue doit être >= à la date de début.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // ============================================================
  // Soumission
  // ============================================================

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGlobalError(null)
    setSuccessMessage(null)

    if (!validate()) return

    setIsLoading(true)

    const budgetNum = form.budget_alloue
      ? Number(form.budget_alloue.replace(/\s/g, ''))
      : undefined

    try {
      const response = await fetch('/api/chantiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: form.nom,
          client_nom: form.client_nom,
          adresse: form.adresse,
          code_postal: form.code_postal,
          ...(budgetNum ? { budget_alloue: budgetNum } : {}),
          date_debut: form.date_debut,
          date_fin_prevue: form.date_fin_prevue,
        }),
      })

      if (response.status === 402) {
        setGlobalError("Votre essai a expiré — passez en payant pour créer un chantier.")
        return
      }

      if (response.status === 400) {
        const data = await response.json() as {
          error?: string
          fields?: Record<string, string[]>
        }
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

      const chantier = await response.json() as { id: string }
      setSuccessMessage('Chantier créé avec succès !')

      // Redirect vers le détail du chantier créé
      setTimeout(() => {
        router.push(`/admin/chantiers/${chantier.id}`)
      }, 800)
    } catch {
      setGlobalError('Erreur réseau. Vérifiez votre connexion.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    // Effacer l'erreur du champ quand l'utilisateur tape
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/chantiers"
          className="text-xs text-muted flex items-center gap-1 mb-3 hover:text-primary transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Retour aux chantiers
        </Link>
        <h1 className="font-heading font-bold text-[28px]">Nouveau chantier</h1>
      </div>

      {/* Succès */}
      {successMessage && (
        <div className="card-brutal p-4 border-l-4 border-l-success bg-success-bg mb-6">
          <p className="text-success font-semibold">{successMessage}</p>
        </div>
      )}

      {/* Erreur globale */}
      {globalError && (
        <div className="card-brutal p-4 border-l-4 border-l-danger bg-danger-bg mb-6">
          <p className="text-danger font-semibold">{globalError}</p>
        </div>
      )}

      {/* Formulaire */}
      <div className="card-brutal p-8 max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Nom du chantier */}
          <div>
            <label
              htmlFor="nom"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Nom du chantier <span className="text-danger">*</span>
            </label>
            <input
              id="nom"
              type="text"
              value={form.nom}
              onChange={(e) => handleChange('nom', e.target.value)}
              placeholder="Ex : Résidence Les Pins"
              className={`input-brutal ${errors['nom'] ? 'error' : ''}`}
              maxLength={100}
              required
            />
            {errors['nom'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['nom']}</p>
            )}
          </div>

          {/* Client */}
          <div>
            <label
              htmlFor="client_nom"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Client <span className="text-danger">*</span>
            </label>
            <input
              id="client_nom"
              type="text"
              value={form.client_nom}
              onChange={(e) => handleChange('client_nom', e.target.value)}
              placeholder="Nom du client ou de la société"
              className={`input-brutal ${errors['client_nom'] ? 'error' : ''}`}
              maxLength={200}
              required
            />
            {errors['client_nom'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['client_nom']}</p>
            )}
          </div>

          {/* Adresse */}
          <div>
            <label
              htmlFor="adresse"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Adresse <span className="text-danger">*</span>
            </label>
            <input
              id="adresse"
              type="text"
              value={form.adresse}
              onChange={(e) => handleChange('adresse', e.target.value)}
              placeholder="14 rue des Lilas"
              className={`input-brutal ${errors['adresse'] ? 'error' : ''}`}
              required
            />
            {errors['adresse'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['adresse']}</p>
            )}
          </div>

          {/* Code postal — US-010 S2 validation inline */}
          <div>
            <label
              htmlFor="code_postal"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Code postal <span className="text-danger">*</span>
            </label>
            <input
              id="code_postal"
              type="text"
              value={form.code_postal}
              onChange={(e) => handleChange('code_postal', e.target.value)}
              placeholder="75001"
              className={`input-brutal ${errors['code_postal'] ? 'error' : ''}`}
              maxLength={5}
              pattern="\d{5}"
              required
            />
            {errors['code_postal'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['code_postal']}</p>
            )}
          </div>

          {/* Budget alloué (optionnel — Q5) */}
          <div>
            <label
              htmlFor="budget_alloue"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Budget alloué (€){' '}
              <span className="text-muted font-normal normal-case">(optionnel)</span>
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
            {errors['budget_alloue'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['budget_alloue']}</p>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="date_debut"
                className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
              >
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
              {errors['date_debut'] && (
                <p className="text-danger text-sm font-medium mt-1">{errors['date_debut']}</p>
              )}
            </div>
            <div>
              <label
                htmlFor="date_fin_prevue"
                className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
              >
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
              {errors['date_fin_prevue'] && (
                <p className="text-danger text-sm font-medium mt-1">{errors['date_fin_prevue']}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={isLoading}
              className="btn-brutal bg-accent text-white disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Création...
                </span>
              ) : (
                'Créer le chantier'
              )}
            </button>
            <Link
              href="/admin/chantiers"
              className="btn-brutal bg-white text-primary"
            >
              Annuler
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
