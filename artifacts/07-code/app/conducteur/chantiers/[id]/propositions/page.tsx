'use client'
// app/conducteur/chantiers/[id]/propositions/page.tsx
// Page propositions bot pour le conducteur
//
// Implements: US-071 (liste propositions), US-072 (édition), US-075 (validation), US-077 (rejet)
// RBAC : conducteur UNIQUEMENT — protégé par middleware
// EXI-8-06 BINDING : JSX pur — ProposalQueueItem gère le rendu sans dangerouslySetInnerHTML
// data-testid="propositions-page-conducteur"

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ProposalQueueItem } from '@/components/chat/ProposalQueueItem'
import type { ActionProposal } from '@/types/chat'

interface PageProps {
  params: Promise<{ id: string }>
}

type StatutFilter = 'pending' | 'valide' | 'rejete' | 'execute' | 'all'

export default function PropositionsPage({ params }: PageProps) {
  const { id: chantierId } = use(params)
  const [proposals, setProposals] = useState<ActionProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statutFilter, setstatutFilter] = useState<StatutFilter>('pending')

  const loadProposals = async (statut: StatutFilter) => {
    setLoading(true)
    try {
      const url = statut === 'all'
        ? `/api/chantiers/${chantierId}/action-proposals?limit=20`
        : `/api/chantiers/${chantierId}/action-proposals?statut=${statut}&limit=20`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setError(body.error ?? 'Erreur chargement.')
        return
      }
      const data = await res.json() as { proposals: ActionProposal[] }
      setProposals(data.proposals)
    } catch {
      setError('Erreur de connexion.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProposals(statutFilter)
  }, [chantierId, statutFilter])

  const handleValider = async (proposalId: string) => {
    const res = await fetch(`/api/action-proposals/${proposalId}/valider`, {
      method: 'PATCH',
      credentials: 'include',
    })
    if (res.ok) {
      void loadProposals(statutFilter)
    }
  }

  const handleRejeter = async (proposalId: string) => {
    const res = await fetch(`/api/action-proposals/${proposalId}/rejeter`, {
      method: 'PATCH',
      credentials: 'include',
    })
    if (res.ok) {
      void loadProposals(statutFilter)
    }
  }

  const handleSavePayload = async (proposalId: string, newPayload: Record<string, unknown>) => {
    const res = await fetch(`/api/action-proposals/${proposalId}/payload`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(newPayload),
    })
    if (res.ok) {
      void loadProposals(statutFilter)
    } else {
      const body = await res.json() as { error?: string }
      throw new Error(body.error ?? 'Erreur sauvegarde.')
    }
  }

  return (
    <div
      data-testid="propositions-page-conducteur"
      className="pb-20 px-4 max-w-2xl mx-auto"
    >
      <div className="flex items-center gap-3 mb-6 pt-4">
        <Link
          href={`/conducteur/chantiers/${chantierId}`}
          className="text-xs text-muted flex items-center gap-1 hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au chantier
        </Link>
      </div>

      <h1 className="font-heading font-bold text-2xl mb-4">Propositions Claw</h1>

      {/* Filtres statut */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['pending', 'valide', 'rejete', 'execute', 'all'] as StatutFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`filter-${s}`}
            onClick={() => setstatutFilter(s)}
            className={`px-3 py-1 text-xs font-bold border-2 border-[var(--color-border-black)] rounded transition-colors ${
              statutFilter === s
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-white text-[var(--color-text-primary)] hover:bg-gray-100'
            }`}
          >
            {s === 'pending' ? 'En attente' : s === 'valide' ? 'Validés' : s === 'rejete' ? 'Rejetés' : s === 'execute' ? 'Exécutés' : 'Tous'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          Chargement...
        </div>
      )}

      {error && (
        <div className="text-red-600 text-sm mb-4" role="alert">
          {error}
        </div>
      )}

      {!loading && proposals.length === 0 && (
        <div
          data-testid="propositions-empty"
          className="card-brutal-mobile p-6 text-center"
        >
          <p className="font-heading font-bold text-base mb-1">Aucune proposition</p>
          <p className="text-xs text-muted">
            Claw génère des propositions lorsque vous ou votre équipe mentionnez des actions dans le chat.
          </p>
        </div>
      )}

      <div
        data-testid="propositions-list-conducteur"
        className="space-y-3"
      >
        {proposals.map((proposal) => (
          <ProposalQueueItem
            key={proposal.id}
            proposal={proposal}
            role="conducteur"
            onValider={handleValider}
            onRejeter={handleRejeter}
            onSavePayload={handleSavePayload}
          />
        ))}
      </div>
    </div>
  )
}
