import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// Design: Neubrutalism BTP — border 2px, radius 4px (badges), variants custom BTP
// Piège: ne pas utiliser les noms shadcn par défaut si style ne correspond pas
//   → variants custom : danger, success, warning, muted, accent, primary

const badgeVariants = cva(
  // Base — border 2px, radius 4px (badges), Outfit 700
  'inline-flex items-center rounded-[4px] border-2 px-2 py-0.5 text-xs font-heading font-bold transition-colors',
  {
    variants: {
      variant: {
        // Neutre / outline noir — fallback neutre (remplace "default" shadcn bleu)
        default: 'border-black bg-white text-[#222222]',
        // Primary bleu BTP
        primary: 'border-[#1F4E79] bg-[#D6E4F0] text-[#1F4E79]',
        // Accent orange
        accent: 'border-[#F97316] bg-[#FFEDD5] text-[#C2410C]',
        // Danger rouge
        danger: 'border-[#C00000] bg-[#FFCCCC] text-[#C00000]',
        // Warning ambre
        warning: 'border-[#833C00] bg-[#FCE4D6] text-[#833C00]',
        // Success vert
        success: 'border-[#1E6B3C] bg-[#E2EFDA] text-[#1E6B3C]',
        // Muted gris (ouvrier, statut neutre)
        muted: 'border-[#555555] bg-[#F2F2F2] text-[#555555]',
        // Destructive (alias danger pour compatibilité shadcn)
        destructive: 'border-[#C00000] bg-[#FFCCCC] text-[#C00000]',
        // Secondary (alias muted)
        secondary: 'border-[#555555] bg-[#F2F2F2] text-[#555555]',
        // Outline neutre sans fond
        outline: 'border-black bg-transparent text-[#222222]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
