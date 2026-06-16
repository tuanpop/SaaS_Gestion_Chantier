'use client'
// components/chat/ProposalQueueItem.tsx — Item dans la file de propositions bot
//
// Implements: US-071 (affichage proposition), US-072 (édition), US-075 (validation), US-077 (rejet)
// RBAC : conducteur + admin voient ce composant (ouvrier n'a pas accès à la file)
// EXI-8-06 BINDING : JSX pur — jamais dangerouslySetInnerHTML
// Design : design-notes-sprint-8.md §5 (card proposition, badges statut)
// data-testid : data-testid="proposal-item-{id}" + actions individuelles

import { useState } from 'react'
import { PayloadEditForm } from '@/components/chat/PayloadEditForm'
import type { ActionProposal } from '@/types/chat'

// ============================================================
// Props
// ============================================================

interface ProposalQueueItemProps {
  proposal: ActionProposal
  role: 'admin' | 'conducteur'
  onValider: (proposalId: string) => Promise<void>
  onRejeter: (proposalId: string) => Promise<void>
  onSavePayload: (proposalId: string, newPayload: Record<string, unknown>) => Promise<void>
}

// ============================================================
// Labels
// ============================================================

function labelType(type: string): string {
  switch (type) {
    case 'creer_tache':  return 'Créer une tâche'
    case 'ajouter_cr':   return 'Ajouter au CR'
    case 'replanifier':  return 'Replanifier'
    case 'alerte':       return 'Émettre une alerte'
    default:             return type
  }
}

function labelStatut(statut: string): { label: string; color: string } {
  switch (statut) {
    case 'pending':  return { label: 'En attente', color: 'var(--color-proposal-pending-border)' }
    case 'valide':   return { label: 'Validé', color: 'var(--color-proposal-valide-border)' }
    case 'rejete':   return { label: 'Rejeté', color: '#6B7280' }
    case 'execute':  return { label: 'Exécuté', color: 'var(--color-proposal-execute-border)' }
    default:         return { label: statut, color: '#6B7280' }
  }
}

// ============================================================
// ProposalQueueItem
// ============================================================

export function ProposalQueueItem({
  proposal,
  role: _role, // préfixe _ = unused intentionnel (pour RBAC futur côté composant)
  onValider,
  onRejeter,
  onSavePayload,
}: ProposalQueueItemProps) {
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState<'valider' | 'rejeter' | null>(null)

  const statutConfig = labelStatut(proposal.statut)
  const isPending = proposal.statut === 'pending'

  const handleValider = async () => {
    setLoading('valider')
    try {
      await onValider(proposal.id)
    } finally {
      setLoading(null)
    }
  }

  const handleRejeter = async () => {
    setLoading('rejeter')
    try {
      await onRejeter(proposal.id)
    } finally {
      setLoading(null)
    }
  }

  const handleSavePayload = async (proposalId: string, newPayload: Record<string, unknown>) => {
    await onSavePayload(proposalId, newPayload)
    setEditing(false)
  }

  // Résumé payload simplifié (pas de JSON brut)
  const payloadResume = buildPayloadResume(proposal)

  return (
    <div
      data-testid={`proposal-item-${proposal.id}`}
      data-statut={proposal.statut}
      className="border-2 border-[var(--color-border-black)] rounded-md p-3 bg-white"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: statutConfig.color,
      }}
    >
      {/* En-tête : type + statut */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-heading font-bold text-sm">
          {labelType(proposal.type)}
        </span>
        <span
          data-testid={`proposal-statut-${proposal.id}`}
          className="text-xs font-semibold px-2 py-0.5 rounded"
          style={{ color: statutConfig.color, backgroundColor: `${statutConfig.color}15` }}
        >
          {statutConfig.label}
        </span>
      </div>

      {/* Résumé payload — JSX pur (EXI-8-06) */}
      {!editing && (
        <div
          data-testid={`proposal-payload-${proposal.id}`}
          className="text-xs text-[var(--color-text-muted)] mb-2 space-y-0.5"
        >
          {payloadResume.map((line, i) => (
            <div key={i}>
              <span className="font-medium">{line.label} :</span>{' '}
              <span>{line.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Erreur d'exécution si présente */}
      {proposal.erreur_execution && (
        <div
          data-testid={`proposal-error-${proposal.id}`}
          className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-1.5 mb-2"
          role="alert"
        >
          {/* EXI-8-06 : JSX pur */}
          {proposal.erreur_execution}
        </div>
      )}

      {/* Formulaire d'édition payload (pending uniquement) */}
      {editing && isPending && (
        <PayloadEditForm
          proposal={proposal}
          onSave={handleSavePayload}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* Actions — pending uniquement */}
      {isPending && !editing && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            data-testid={`proposal-valider-${proposal.id}`}
            disabled={loading !== null}
            onClick={handleValider}
            className="flex-1 py-1.5 text-xs font-bold text-white bg-[#15803D] border-2 border-[var(--color-border-black)] rounded disabled:opacity-50 hover:bg-[#166534]"
          >
            {loading === 'valider' ? 'Validation...' : 'Valider'}
          </button>

          {/* Édition payload (conducteur + admin) */}
          <button
            type="button"
            data-testid={`proposal-edit-${proposal.id}`}
            disabled={loading !== null}
            onClick={() => setEditing(true)}
            className="py-1.5 px-3 text-xs font-bold bg-[var(--color-surface)] border-2 border-[var(--color-border-black)] rounded disabled:opacity-50 hover:bg-gray-200"
          >
            Modifier
          </button>

          <button
            type="button"
            data-testid={`proposal-rejeter-${proposal.id}`}
            disabled={loading !== null}
            onClick={handleRejeter}
            className="flex-1 py-1.5 text-xs font-bold text-white bg-[var(--color-danger)] border-2 border-[var(--color-border-black)] rounded disabled:opacity-50 hover:opacity-90"
          >
            {loading === 'rejeter' ? 'Rejet...' : 'Rejeter'}
          </button>
        </div>
      )}

      {/* Métadonnées — date création */}
      <div className="text-xs text-[var(--color-text-muted)] mt-2">
        {new Date(proposal.created_at).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    </div>
  )
}

// ============================================================
// buildPayloadResume — résumé lisible du payload (JSX pur)
// EXI-8-06 : valeurs textuelles, pas de HTML injecté
// ============================================================

function buildPayloadResume(
  proposal: ActionProposal,
): Array<{ label: string; value: string }> {
  const p = proposal.payload as unknown as Record<string, unknown>

  switch (proposal.type) {
    case 'creer_tache':
      return [
        { label: 'Titre', value: String(p['titre'] ?? '—') },
        ...(p['description'] ? [{ label: 'Description', value: String(p['description']) }] : []),
        ...(p['date_echeance'] ? [{ label: 'Échéance', value: String(p['date_echeance']) }] : []),
      ]
    case 'ajouter_cr':
      return [
        { label: 'Note', value: String(p['note'] ?? '—') },
      ]
    case 'replanifier':
      return [
        { label: 'Cible', value: String(p['cible'] ?? '—') },
        { label: 'Nouvelle date', value: String(p['nouvelle_date'] ?? '—') },
        ...(p['raison'] ? [{ label: 'Raison', value: String(p['raison']) }] : []),
      ]
    case 'alerte':
      return [
        { label: 'Titre', value: String(p['titre'] ?? '—') },
        { label: 'Message', value: String(p['message'] ?? '—') },
        { label: 'Destinataires', value: String(p['destinataires'] ?? '—') },
      ]
    default:
      return []
  }
}

export default ProposalQueueItem
