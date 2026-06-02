import * as React from 'react'
import { cn } from '@/lib/utils'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// Design: Neubrutalism BTP — border-2 border-black, radius 6px, focus ring orange
// Piège 1 : --radius = 0.375rem (6px) — déjà dans globals.css, ne pas utiliser rounded-md shadcn
// Piège 3 : border-2 border-black obligatoire (pas le border-1 shadcn par défaut)
// font-size: 16px critique (iOS — empêche le zoom automatique)

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Neubrutalism BTP — équivalent .input-brutal
          'flex h-11 w-full rounded-[6px] border-2 border-black bg-white px-3 py-2',
          'text-[16px] font-sans text-[#222222] placeholder:text-[#555555]',
          // Focus : ring orange accent (pas bleu shadcn)
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(249,115,22)] focus-visible:ring-offset-1',
          // Disabled
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[#F2F2F2] disabled:border-[#999]',
          // Error state (className contenant 'error' ou aria-invalid)
          'aria-invalid:border-[#C00000] aria-invalid:ring-[#C00000]',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
