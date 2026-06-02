'use client'

// SECURITY: K2.5-T-07 — pas de dangerouslySetInnerHTML
// Piège 8 component-mapping : <Toaster /> en root layout UNIQUEMENT — ne pas double-placer
// Import useToast depuis @/lib/hooks/use-toast (pas depuis components/ui/)

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'
import { useToast } from '@/lib/hooks/use-toast'

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                // SECURITY: K2.5-T-08 — description est JSX (React.ReactNode), pas une string concaténée
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
