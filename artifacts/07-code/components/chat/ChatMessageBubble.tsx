'use client'
// components/chat/ChatMessageBubble.tsx — Bulle de message chat
//
// EXI-8-06 BINDING : JSX pur UNIQUEMENT — jamais dangerouslySetInnerHTML
//   Le contenu est rendu via {msg.contenu} — React échappe automatiquement le HTML
//   Les données sont stockées brutes en DB, le rendu sécurisé est ici côté UI
// D-8-09 BINDING : messages supprimés (deleted_at IS NULL côté API)
//   Ce composant ne reçoit que les messages NON supprimés (filtrés par API GET)
// Design : design-notes-sprint-8.md §4 (bulles, RBAC, admin suppression)
// data-testid : convention data-testid="chat-msg-{id}" (spec UX §5)

import { cn } from '@/lib/utils'
import type { MessageChat } from '@/types/chat'

// ============================================================
// Props
// ============================================================

interface ChatMessageBubbleProps {
  message: MessageChat
  isCurrentUser: boolean
  role: 'admin' | 'conducteur' | 'ouvrier'
  onDelete?: (messageId: string) => void | Promise<void> // admin uniquement
}

// ============================================================
// formatHeure — HH:MM
// ============================================================

function formatHeure(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ============================================================
// ChatMessageBubble
// ============================================================

export function ChatMessageBubble({
  message,
  isCurrentUser,
  role,
  onDelete,
}: ChatMessageBubbleProps) {
  // Message type='system' — rendu centré, style distinct
  if (message.type === 'system') {
    return (
      <div
        data-testid={`chat-msg-${message.id}`}
        data-type="system"
        className="flex justify-center my-2"
      >
        <div
          className="text-xs px-3 py-1 rounded-full"
          style={{
            backgroundColor: 'var(--color-chat-bubble-system-bg)',
            color: 'var(--color-chat-bubble-system-text)',
            border: '1px solid var(--color-chat-bubble-system-border)',
          }}
        >
          {/* EXI-8-06 : JSX pur — contenu échappé automatiquement */}
          {message.contenu}
        </div>
      </div>
    )
  }

  // Message type='bot' — bulle verte à gauche (Claw)
  if (message.type === 'bot') {
    return (
      <div
        data-testid={`chat-msg-${message.id}`}
        data-type="bot"
        className="flex flex-col items-start mb-3"
      >
        <div className="flex items-center gap-1 mb-1">
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--color-chat-bubble-bot-text)' }}
          >
            Claw
          </span>
          <time
            className="text-xs"
            style={{ color: 'var(--color-text-muted)' }}
            dateTime={message.created_at}
          >
            {formatHeure(message.created_at)}
          </time>
        </div>
        <div
          className="max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words"
          style={{
            backgroundColor: 'var(--color-chat-bubble-bot-bg)',
            color: 'var(--color-chat-bubble-bot-text)',
            border: '1.5px solid var(--color-chat-bubble-bot-border)',
          }}
        >
          {/* EXI-8-06 : JSX pur — jamais dangerouslySetInnerHTML */}
          {message.contenu}
        </div>
      </div>
    )
  }

  // Message type='user' — bulle à droite si isCurrentUser, gauche sinon
  const isOwnMessage = isCurrentUser

  return (
    <div
      data-testid={`chat-msg-${message.id}`}
      data-type="user"
      data-author-role={message.auteur_role ?? 'unknown'}
      className={cn(
        'flex flex-col mb-3',
        isOwnMessage ? 'items-end' : 'items-start',
      )}
    >
      {/* En-tête : nom + heure + bouton suppression admin */}
      <div className={cn('flex items-center gap-2 mb-1', isOwnMessage && 'flex-row-reverse')}>
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          {/* EXI-8-06 : JSX pur */}
          {message.auteur_nom ?? 'Utilisateur'}
        </span>
        {message.auteur_role && (
          <span className="text-xs text-[var(--color-text-muted)]">
            ({message.auteur_role})
          </span>
        )}
        <time
          className="text-xs text-[var(--color-text-muted)]"
          dateTime={message.created_at}
        >
          {formatHeure(message.created_at)}
        </time>

        {/* Bouton suppression — admin uniquement (US-083) */}
        {role === 'admin' && onDelete && (
          <button
            type="button"
            data-testid={`chat-msg-delete-${message.id}`}
            aria-label="Supprimer ce message"
            onClick={() => onDelete(message.id)}
            className="text-xs text-red-500 hover:text-red-700 opacity-60 hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        )}
      </div>

      {/* Bulle de message */}
      <div
        className={cn(
          'max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words',
          isOwnMessage
            ? 'border-2 border-[var(--color-chat-bubble-user-border)]'
            : 'border border-[var(--color-border-black)]',
        )}
        style={
          isOwnMessage
            ? {
                backgroundColor: 'var(--color-chat-bubble-user-bg)',
                color: 'var(--color-chat-bubble-user-text)',
              }
            : {
                backgroundColor: '#FFFFFF',
                color: 'var(--color-text-primary)',
              }
        }
      >
        {/* EXI-8-06 BINDING : JSX pur — jamais dangerouslySetInnerHTML */}
        {message.contenu}
      </div>

      {/* Badge proposition liée */}
      {message.action_proposal_id && (
        <div className="mt-1 text-xs text-[var(--color-notif-action-proposal)] font-medium">
          Proposition Claw associée
        </div>
      )}
    </div>
  )
}

export default ChatMessageBubble
