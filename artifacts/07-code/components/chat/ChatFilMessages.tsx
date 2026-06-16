'use client'
// components/chat/ChatFilMessages.tsx — Fil de messages avec polling 30s
//
// Implements: US-066 (envoyer message), US-069 (historique + polling)
// PO-8-01=A BINDING : polling 30s (pas de WebSocket/Realtime — D-8-11)
//   useEffect setInterval 30000ms — rechargement GET /messages
// D-8-06 BINDING : pagination cursor-based, limit=50 enforced server-side
//   Scroll vers le haut = charger cursor précédent (load more)
// EXI-8-06 BINDING : JSX pur — jamais dangerouslySetInnerHTML
//   ChatMessageBubble reçoit les données et rend en JSX pur
// D-8-03 BINDING : type='user' toujours (backend force)
// data-testid="chat-fil-messages", "chat-input", "chat-send-btn"

import { useState, useEffect, useRef, useCallback } from 'react'
import { ChatMessageBubble } from '@/components/chat/ChatMessageBubble'
import type { MessageChat } from '@/types/chat'

// ============================================================
// Props
// ============================================================

interface ChatFilMessagesProps {
  chantierId: string
  currentUserId: string
  currentUserRole: 'admin' | 'conducteur' | 'ouvrier'
  /** Nom complet de l'utilisateur courant (pour identifier ses bulles) */
  currentUserNom?: string
}

// ============================================================
// ChatFilMessages
// ============================================================

export function ChatFilMessages({
  chantierId,
  currentUserId,
  currentUserRole,
  currentUserNom: _currentUserNom, // préfixe _ = unused intentionnel (disponible pour affichage futur)
}: ChatFilMessagesProps) {
  const [messages, setMessages] = useState<MessageChat[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Cursor = created_at du message le plus ancien chargé (pour load more)
  const oldestCursorRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Chargement initial ────────────────────────────────────
  const loadMessages = useCallback(async (isRefresh = false) => {
    try {
      const res = await fetch(
        `/api/chantiers/${chantierId}/chat/messages?limit=50`,
        { credentials: 'include' },
      )
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setError(body.error ?? 'Erreur chargement messages.')
        return
      }
      const data = await res.json() as { messages: MessageChat[]; has_more: boolean }
      setMessages(data.messages)
      setHasMore(data.has_more)

      // Cursor = created_at du premier message (le plus ancien)
      if (data.messages.length > 0 && data.messages[0]) {
        oldestCursorRef.current = data.messages[0].created_at
      }

      if (!isRefresh) {
        // Scroll vers le bas au chargement initial
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
      }
    } catch {
      setError('Erreur de connexion.')
    } finally {
      setLoading(false)
    }
  }, [chantierId])

  // ── Polling 30s (PO-8-01=A BINDING) ──────────────────────
  const pollMessages = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/chantiers/${chantierId}/chat/messages?limit=50`,
        { credentials: 'include' },
      )
      if (!res.ok) return
      const data = await res.json() as { messages: MessageChat[]; has_more: boolean }

      // Merger avec les messages existants (éviter duplicates)
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        const newMessages = data.messages.filter((m) => !existingIds.has(m.id))
        if (newMessages.length === 0) return prev
        // Scroll vers le bas si nouveaux messages
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 50)
        return [...prev, ...newMessages]
      })
    } catch {
      // Polling silencieux — pas d'erreur visible
    }
  }, [chantierId])

  useEffect(() => {
    void loadMessages()

    // PO-8-01=A BINDING : polling 30000ms
    pollingRef.current = setInterval(() => {
      void pollMessages()
    }, 30000)

    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current)
      }
    }
  }, [loadMessages, pollMessages])

  // ── Load more (scroll vers le haut) ──────────────────────
  const loadMore = async () => {
    if (!hasMore || loadingMore || !oldestCursorRef.current) return
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/chantiers/${chantierId}/chat/messages?limit=50&cursor=${encodeURIComponent(oldestCursorRef.current)}`,
        { credentials: 'include' },
      )
      if (!res.ok) return
      const data = await res.json() as { messages: MessageChat[]; has_more: boolean }

      setMessages((prev) => [...data.messages, ...prev])
      setHasMore(data.has_more)

      if (data.messages.length > 0 && data.messages[0]) {
        oldestCursorRef.current = data.messages[0].created_at
      }
    } catch {
      // Silencieux
    } finally {
      setLoadingMore(false)
    }
  }

  // ── Envoi message ────────────────────────────────────────
  const handleSend = async () => {
    const contenu = inputValue.trim()
    if (!contenu || sending) return

    setSending(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/chantiers/${chantierId}/chat/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ contenu }),
        },
      )

      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setError(body.error ?? 'Erreur lors de l\'envoi.')
        return
      }

      const newMessage = await res.json() as MessageChat
      setInputValue('')
      setMessages((prev) => [...prev, newMessage])

      // Scroll vers le bas
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
    } catch {
      setError('Erreur de connexion.')
    } finally {
      setSending(false)
    }
  }

  // ── Suppression message (admin) ──────────────────────────
  const handleDeleteMessage = async (messageId: string) => {
    if (currentUserRole !== 'admin') return
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        // Retrait optimiste du fil
        setMessages((prev) => prev.filter((m) => m.id !== messageId))
      }
    } catch {
      // Silencieux
    }
  }

  // ── Keyboard handler ─────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // ── Rendu ────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        data-testid="chat-fil-messages"
        className="flex items-center justify-center p-8 text-[var(--color-text-muted)]"
      >
        Chargement du chat...
      </div>
    )
  }

  return (
    <div
      data-testid="chat-fil-messages"
      className="flex flex-col h-full"
    >
      {/* Bouton load more */}
      {hasMore && (
        <div className="flex justify-center p-2">
          <button
            type="button"
            data-testid="chat-load-more"
            disabled={loadingMore}
            onClick={loadMore}
            className="text-xs text-[var(--color-primary)] underline disabled:opacity-50"
          >
            {loadingMore ? 'Chargement...' : 'Charger les messages précédents'}
          </button>
        </div>
      )}

      {/* Fil de messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0">
        {messages.length === 0 && (
          <div
            data-testid="chat-empty"
            className="text-center text-[var(--color-text-muted)] text-sm py-8"
          >
            Aucun message pour le moment. Soyez le premier à écrire !
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageBubble
            key={msg.id}
            message={msg}
            isCurrentUser={msg.auteur_id === currentUserId}
            role={currentUserRole}
            // exactOptionalPropertyTypes : spread conditionnel plutôt que onDelete={undefined}
            {...(currentUserRole === 'admin' ? { onDelete: handleDeleteMessage } : {})}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Erreur */}
      {error && (
        <div
          className="px-4 py-2 text-sm text-red-600 bg-red-50"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Zone de saisie */}
      <div className="border-t-2 border-[var(--color-border-black)] p-3 bg-white flex gap-2">
        <textarea
          data-testid="chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={2}
          maxLength={4000}
          placeholder="Écris un message... (Entrée pour envoyer, Maj+Entrée pour retour à la ligne)"
          className="flex-1 resize-none border-2 border-[var(--color-border-black)] rounded p-2 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          data-testid="chat-send-btn"
          disabled={!inputValue.trim() || sending}
          onClick={() => void handleSend()}
          className="px-4 py-2 text-sm font-bold text-white bg-[var(--color-primary)] border-2 border-[var(--color-border-black)] rounded disabled:opacity-50 hover:bg-[var(--color-primary-dark)] self-end"
          aria-label="Envoyer le message"
        >
          {sending ? '...' : 'Envoyer'}
        </button>
      </div>

      {/* Compteur caractères */}
      {inputValue.length > 3800 && (
        <div className="px-4 pb-1 text-xs text-[var(--color-text-muted)] text-right">
          {inputValue.length}/4000
        </div>
      )}
    </div>
  )
}

export default ChatFilMessages
