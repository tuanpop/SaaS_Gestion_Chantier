'use client'
// components/chat/PayloadEditForm.tsx — Formulaire d'édition payload avant validation
//
// Implements: US-072 (édition payload conducteur)
// EXI-8-06 BINDING : JSX pur — inputs contrôlés via value/onChange (pas dangerouslySetInnerHTML)
// D-8-14 : l'UI n'envoie QUE les champs métier — chantier_id/organisation_id exclus du formulaire
// Validation Zod : validée côté API (PATCH .../payload) — formulaire = édition UX simple
// Design : design-notes-sprint-8.md §5 (formulaires propositions)

import { useState } from 'react'
import type { ActionProposal, ActionType } from '@/types/chat'

// ============================================================
// Props
// ============================================================

interface PayloadEditFormProps {
  proposal: ActionProposal
  onSave: (proposalId: string, newPayload: Record<string, unknown>) => Promise<void>
  onCancel: () => void
  disabled?: boolean
}

// ============================================================
// PayloadEditForm
// ============================================================

export function PayloadEditForm({
  proposal,
  onSave,
  onCancel,
  disabled = false,
}: PayloadEditFormProps) {
  const [payload, setPayload] = useState<Record<string, unknown>>(
    proposal.payload as unknown as Record<string, unknown>,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(proposal.id, payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (key: string, value: unknown) => {
    setPayload((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div
      data-testid={`payload-edit-form-${proposal.id}`}
      className="border-2 border-[var(--color-border-black)] rounded-md p-3 bg-white"
    >
      <h4 className="font-heading font-bold text-sm mb-3">
        Modifier la proposition — {labelType(proposal.type)}
      </h4>

      {/* Rendu des champs selon le type d'action */}
      {renderFields(proposal.type, payload, updateField, disabled || saving)}

      {error && (
        <p className="text-red-600 text-xs mt-2" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          data-testid={`payload-save-${proposal.id}`}
          disabled={disabled || saving}
          onClick={handleSave}
          className="flex-1 py-1.5 text-sm font-bold bg-[var(--color-primary)] text-white border-2 border-[var(--color-border-black)] rounded disabled:opacity-50"
        >
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
        <button
          type="button"
          data-testid={`payload-cancel-${proposal.id}`}
          disabled={saving}
          onClick={onCancel}
          className="flex-1 py-1.5 text-sm font-bold bg-[var(--color-surface)] border-2 border-[var(--color-border-black)] rounded disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================

function labelType(type: ActionType): string {
  switch (type) {
    case 'creer_tache':   return 'Créer une tâche'
    case 'ajouter_cr':    return 'Ajouter au CR'
    case 'replanifier':   return 'Replanifier'
    case 'alerte':        return 'Alerte'
  }
}

function renderFields(
  type: ActionType,
  payload: Record<string, unknown>,
  update: (key: string, value: unknown) => void,
  disabled: boolean,
): React.ReactNode {
  switch (type) {
    case 'creer_tache':
      return (
        <div className="space-y-2">
          <FieldText
            label="Titre *"
            fieldKey="titre"
            value={String(payload['titre'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={200}
            testId="field-titre"
          />
          <FieldText
            label="Description"
            fieldKey="description"
            value={String(payload['description'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={500}
            testId="field-description"
          />
          <FieldText
            label="Date d'échéance (YYYY-MM-DD)"
            fieldKey="date_echeance"
            value={String(payload['date_echeance'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={10}
            testId="field-date-echeance"
          />
        </div>
      )

    case 'ajouter_cr':
      return (
        <div className="space-y-2">
          <FieldTextArea
            label="Note *"
            fieldKey="note"
            value={String(payload['note'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={500}
            testId="field-note"
          />
        </div>
      )

    case 'replanifier':
      return (
        <div className="space-y-2">
          <FieldText
            label="Nouvelle date (YYYY-MM-DD) *"
            fieldKey="nouvelle_date"
            value={String(payload['nouvelle_date'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={10}
            testId="field-nouvelle-date"
          />
          <FieldText
            label="Raison"
            fieldKey="raison"
            value={String(payload['raison'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={200}
            testId="field-raison"
          />
        </div>
      )

    case 'alerte':
      return (
        <div className="space-y-2">
          <FieldText
            label="Titre *"
            fieldKey="titre"
            value={String(payload['titre'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={150}
            testId="field-titre"
          />
          <FieldTextArea
            label="Message *"
            fieldKey="message"
            value={String(payload['message'] ?? '')}
            onChange={update}
            disabled={disabled}
            maxLength={500}
            testId="field-message"
          />
          <div>
            <label className="text-xs font-semibold">Destinataires *</label>
            <select
              data-testid="field-destinataires"
              disabled={disabled}
              value={String(payload['destinataires'] ?? 'tous')}
              onChange={(e) => update('destinataires', e.target.value)}
              className="w-full mt-1 border-2 border-[var(--color-border-black)] rounded p-1 text-sm"
            >
              <option value="admins">Administrateurs</option>
              <option value="conducteurs">Conducteurs</option>
              <option value="tous">Tous (admin + conducteurs)</option>
            </select>
          </div>
        </div>
      )
  }
}

// ============================================================
// Atoms — champs contrôlés JSX pur (EXI-8-06)
// ============================================================

function FieldText({
  label,
  fieldKey,
  value,
  onChange,
  disabled,
  maxLength,
  testId,
}: {
  label: string
  fieldKey: string
  value: string
  onChange: (key: string, value: unknown) => void
  disabled: boolean
  maxLength: number
  testId: string
}) {
  return (
    <div>
      <label className="text-xs font-semibold">{label}</label>
      <input
        type="text"
        data-testid={testId}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className="w-full mt-1 border-2 border-[var(--color-border-black)] rounded p-1 text-sm disabled:opacity-50"
      />
    </div>
  )
}

function FieldTextArea({
  label,
  fieldKey,
  value,
  onChange,
  disabled,
  maxLength,
  testId,
}: {
  label: string
  fieldKey: string
  value: string
  onChange: (key: string, value: unknown) => void
  disabled: boolean
  maxLength: number
  testId: string
}) {
  return (
    <div>
      <label className="text-xs font-semibold">{label}</label>
      <textarea
        data-testid={testId}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        rows={3}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className="w-full mt-1 border-2 border-[var(--color-border-black)] rounded p-1 text-sm resize-none disabled:opacity-50"
      />
    </div>
  )
}

export default PayloadEditForm
