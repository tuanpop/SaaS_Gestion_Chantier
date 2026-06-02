'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// SECURITY: K2.5-T-08 — description toast = JSX interpolation uniquement (vérifier dans les callers)
// Design: Neubrutalism BTP — border 2px noir, shadow-brutal-sm, radius 6px
// Piège 8 component-mapping : useToast importé depuis @/lib/hooks/use-toast (pas depuis components/ui/)

const ToastProvider = ToastPrimitive.Provider

// ============================================================
// ToastViewport
// ============================================================

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
      className,
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

// ============================================================
// toastVariants — Neubrutalism BTP
// ============================================================

const toastVariants = cva(
  // Base — border 2px noir, shadow-brutal-sm, radius 6px (Neubrutalism)
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden ' +
  'rounded-[6px] border-2 border-black p-4 pr-8 shadow-brutal-sm transition-all ' +
  'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] ' +
  'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none ' +
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out ' +
  'data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full ' +
  'data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border-black bg-white text-[#222222]',
        destructive: 'border-[#C00000] bg-[#FFCCCC] text-[#C00000]',
        success: 'border-[#1E6B3C] bg-[#E2EFDA] text-[#1E6B3C]',
        warning: 'border-[#833C00] bg-[#FCE4D6] text-[#833C00]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

// ============================================================
// Toast
// ============================================================

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitive.Root.displayName

// ============================================================
// ToastAction
// ============================================================

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-[4px] border-2 border-black bg-transparent px-3 text-sm font-heading font-semibold',
      'transition-colors hover:bg-[#F2F2F2] focus:outline-none focus:ring-2 focus:ring-[rgb(249,115,22)] focus:ring-offset-1',
      'disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitive.Action.displayName

// ============================================================
// ToastClose — 44×44px touch target
// ============================================================

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-[4px] p-1 text-[#555555] opacity-0 transition-opacity',
      'hover:text-[#222222] focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[rgb(249,115,22)]',
      'group-hover:opacity-100',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
))
ToastClose.displayName = ToastPrimitive.Close.displayName

// ============================================================
// ToastTitle
// ============================================================

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn('font-heading font-bold text-sm', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitive.Title.displayName

// ============================================================
// ToastDescription
// SECURITY: K2.5-T-08 — description = JSX interpolation uniquement dans les callers
// ============================================================

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn('text-sm text-[#555555]', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitive.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>
type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
