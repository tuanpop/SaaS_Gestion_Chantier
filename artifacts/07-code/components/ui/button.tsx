import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// Design: Neubrutalism BTP — border 2px noir, shadow offset sans blur, radius 6px
// Piège 4 component-mapping : rgb() au lieu de hsl() — tokens déjà en RGB triplets

const buttonVariants = cva(
  // Base : Outfit 700, touch target 44px min, transition transform+shadow 100ms, border 2px noir
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-heading font-bold text-sm ' +
  'border-2 border-black rounded-[6px] transition-[transform,box-shadow] duration-100 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))] focus-visible:ring-offset-2 ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Accent orange — CTA primaire (D-2.5-018)
        default:
          'bg-accent text-white shadow-brutal ' +
          'hover:shadow-brutal-hover hover:-translate-y-[1px] hover:-translate-x-[1px] ' +
          'active:shadow-brutal-active active:translate-y-[2px] active:translate-x-[2px]',
        // Destructive rouge — actions destructives
        destructive:
          'bg-danger text-white shadow-brutal-danger ' +
          'hover:shadow-[5px_5px_0_#C00000] hover:-translate-y-[1px] hover:-translate-x-[1px] ' +
          'active:shadow-none active:translate-y-[2px] active:translate-x-[2px]',
        // Outline — surface blanche, bordure noire
        outline:
          'bg-white text-[#222222] shadow-brutal ' +
          'hover:shadow-brutal-hover hover:-translate-y-[1px] hover:-translate-x-[1px] ' +
          'active:shadow-brutal-active active:translate-y-[2px] active:translate-x-[2px]',
        // Secondary — fond gris surface
        secondary:
          'bg-[#F2F2F2] text-[#222222] shadow-brutal ' +
          'hover:shadow-brutal-hover hover:-translate-y-[1px] hover:-translate-x-[1px] ' +
          'active:shadow-brutal-active active:translate-y-[2px] active:translate-x-[2px]',
        // Ghost — transparent, sans shadow (usage sidebar blanc)
        ghost:
          'border-transparent bg-transparent text-[#222222] shadow-none ' +
          'hover:bg-[#F2F2F2] hover:border-transparent',
        // Link — sans bordure, sans shadow
        link:
          'border-transparent bg-transparent text-accent shadow-none underline-offset-4 ' +
          'hover:underline hover:border-transparent',
        // Primary bleu BTP
        primary:
          'bg-[#1F4E79] text-white shadow-brutal ' +
          'hover:shadow-brutal-hover hover:-translate-y-[1px] hover:-translate-x-[1px] ' +
          'active:shadow-brutal-active active:translate-y-[2px] active:translate-x-[2px]',
      },
      size: {
        default: 'h-11 px-5 py-2',       // 44px — WCAG min desktop
        sm: 'h-9 rounded-[6px] px-3',
        lg: 'h-14 rounded-[6px] px-8',   // 56px — touch target mobile BTP
        icon: 'h-11 w-11',               // 44px carré
        'icon-sm': 'h-9 w-9',
        'icon-lg': 'h-14 w-14',          // 56px touch target
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
