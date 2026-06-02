import * as React from 'react'
import { cn } from '@/lib/utils'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// Design: Neubrutalism BTP — même style que input-brutal
// font-size: 16px critique (iOS — empêche le zoom automatique)
// min-height: 80px pour motif blocage tâche

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          // Neubrutalism BTP — équivalent .input-brutal
          'flex min-h-[80px] w-full rounded-[6px] border-2 border-black bg-white px-3 py-2',
          'text-[16px] font-sans text-[#222222] placeholder:text-[#555555]',
          // resize-y autorisé (design system §6.13)
          'resize-y',
          // Focus : ring orange accent
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(249,115,22)] focus-visible:ring-offset-1',
          // Disabled
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[#F2F2F2] disabled:border-[#999]',
          // Error state
          'aria-invalid:border-[#C00000] aria-invalid:ring-[#C00000]',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
