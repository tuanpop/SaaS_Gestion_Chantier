import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Utilitaire de fusion de classes Tailwind (shadcn/ui pattern).
 * Combine clsx (logique conditionnelle) + tailwind-merge (résolution conflits Tailwind).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
