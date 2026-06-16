'use client'
// app/ouvrier/chantiers/[id]/chat/page.tsx — Chat mobile pour l'ouvrier
//
// Implements: US-066 (ouvrier participant actif au chat)
// RBAC : ouvrier UNIQUEMENT — session cookie
// EXI-8-06 BINDING : ChatFilMessages JSX pur
// PO-8-01=A BINDING : polling 30s dans ChatFilMessages
// D-8-02 BINDING : dual-path auth (cookie ouvrier)
// data-testid="ouvrier-chat-page"
//
// Note : on utilise 'use client' car nous avons besoin de l'état du cookie ouvrier
// L'ouvrierUserId est récupéré via GET /api/ouvrier/me (déjà existant)

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ChatFilMessages } from '@/components/chat/ChatFilMessages'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function OuvrierChatPage({ params }: PageProps) {
  const { id: chantierId } = use(params)
  const [ouvrierUserId, setOuvrierUserId] = useState<string>('')
  const [chantierNom, _setChantierNom] = useState<string>('Chantier') // TODO: fetch chantier nom
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Récupérer infos session ouvrier
    const fetchMe = async () => {
      try {
        const res = await fetch('/api/ouvrier/me', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json() as { user_id?: string }
          setOuvrierUserId(data.user_id ?? '')
        }
      } catch {
        // Best-effort — le chat reste fonctionnel sans ouvrierUserId (identification bulles)
      } finally {
        setLoading(false)
      }
    }
    void fetchMe()
  }, [])

  if (loading) {
    return (
      <div
        data-testid="ouvrier-chat-page"
        className="flex items-center justify-center min-h-screen"
      >
        <span className="text-[var(--color-text-muted)]">Chargement...</span>
      </div>
    )
  }

  return (
    <div
      data-testid="ouvrier-chat-page"
      className="flex flex-col h-dvh"
    >
      {/* Header mobile */}
      <div
        className="flex items-center gap-3 p-3 border-b-2 border-[var(--color-border-black)] bg-[var(--color-primary)] text-white shrink-0"
      >
        <Link
          href={`/ouvrier/chantiers/${chantierId}`}
          className="text-white hover:opacity-80"
          aria-label="Retour au chantier"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="font-heading font-bold text-base">Chat d&apos;équipe</h1>
          {chantierNom && (
            <p className="text-xs opacity-75">{chantierNom}</p>
          )}
        </div>
      </div>

      {/* Chat fil messages — prend tout l'espace disponible */}
      <div className="flex-1 overflow-hidden">
        <ChatFilMessages
          chantierId={chantierId}
          currentUserId={ouvrierUserId}
          currentUserRole="ouvrier"
        />
      </div>
    </div>
  )
}
