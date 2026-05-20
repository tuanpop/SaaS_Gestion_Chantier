'use client'
// app/(conducteur)/chantiers/[id]/taches/nouvelle/client.tsx
// Client Component du formulaire création tâche
//
// Bug 3 (fix dette Sprint 2 — 2026-05-20) :
//   Ajout du champ assigned_to (select) — auparavant absent (reporté Sprint 3 à tort).
//   Le handler POST /api/chantiers/[id]/taches accepte assigned_to depuis Sprint 2,
//   seule l'UI le bloquait. Fix GAP-011-A documenté par Levi.
//
// Liste assignable = ouvriers + conducteurs de l'org (chargée server-side, passée en props).

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import type { TacheStatut } from '@/types/database'

const STATUTS: { value: TacheStatut; label: string }[] = [
  { value: 'a_faire', label: 'À faire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' },
]

export interface AssignableMember {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface NouvelleTacheClientProps {
  membres: AssignableMember[]
}

export function NouvelleTacheClient({ membres }: NouvelleTacheClientProps) {
  const router = useRouter()
  const { id: chantierId } = useParams() as { id: string }

  const [form, setForm] = useState({
    titre: '',
    description: '',
    date_echeance: '',
    statut: 'a_faire' as TacheStatut,
    bloque_raison: '',
    assigned_to: '' as string,
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

          {/* Assigner à — Bug 3 fix Sprint 2 dette */}
          <div>
            <label
              htmlFor="assigned_to"
              className="block font-heading font-semibold text-xs uppercase text-muted mb-2 tracking-wide"
            >
              Assigner à <span className="text-muted font-normal normal-case">(optionnel)</span>
            </label>
            <select
              id="assigned_to"
              data-testid="assigned-to-select"
              value={form.assigned_to}
              onChange={(e) => handleChange('assigned_to', e.target.value)}
              className={`input-brutal ${errors['assigned_to'] ? 'error' : ''}`}
            >
              <option value="">— Non assignée —</option>
              {membres.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.prenom} {m.nom} ({m.role === 'ouvrier' ? 'Ouvrier' : 'Conducteur'})
                </option>
              ))}
            </select>
            {errors['assigned_to'] && (
              <p className="text-danger text-sm font-medium mt-1">{errors['assigned_to']}</p>
            )}
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
              className="btn-brutal btn-brutal-mobile bg-accent text-white w-full justify-center"
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
              className="btn-brutal btn-brutal-mobile bg-white text-primary w-full justify-center"
            >
              Annuler
            </Link>
          </div>
        </form>
      </main>

      {/* Bottom Navigation conducteur */}
      <nav className="bottom-nav">
        <Link href="/conducteur/chantiers">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Chantiers</span>
        </Link>
        <Link href="/conducteur/taches" className="active">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <span>Tâches</span>
        </Link>
        <Link href="/conducteur/cr">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
          <span>CR</span>
        </Link>
        <Link href="/conducteur/alertes" className="relative">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <span>Alertes</span>
        </Link>
        <Link href="/conducteur/chats" className="relative">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>Chats</span>
          <span className="absolute -top-1 right-0 w-4 h-4 bg-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center">7</span>
        </Link>
      </nav>
    </>
  )
}
