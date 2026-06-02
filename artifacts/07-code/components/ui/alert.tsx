import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// Design: Neubrutalism BTP — border 2px noir + border-left 4px colorée, radius 6px
// Variants: default / destructive / warning / success
// role="alert" sur les alertes critiques (RG-MIGR-003)

const alertVariants = cva(
  // Base — border 2px noir, border-left 4px colorée, radius 6px, Neubrutalism
  'relative w-full rounded-[6px] border-2 border-black p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-[#222222]',
  {
    variants: {
      variant: {
        // Neutre — border-left noir
        default: 'border-l-[4px] border-l-[#222222] bg-white text-[#222222]',
        // Destructive rouge
        destructive:
          'border-l-[4px] border-l-[#C00000] bg-[#FFCCCC] text-[#C00000] ' +
          '[&>svg]:text-[#C00000]',
        // Warning ambre
        warning:
          'border-l-[4px] border-l-[#833C00] bg-[#FCE4D6] text-[#833C00] ' +
          '[&>svg]:text-[#833C00]',
        // Success vert
        success:
          'border-l-[4px] border-l-[#1E6B3C] bg-[#E2EFDA] text-[#1E6B3C] ' +
          '[&>svg]:text-[#1E6B3C]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    // role="alert" — alerte accessible (RG-MIGR-003)
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = 'Alert'

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-heading font-bold text-sm leading-none tracking-tight', className)}
    {...props}
  />
))
AlertTitle.displayName = 'AlertTitle'

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
))
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertTitle, AlertDescription }
