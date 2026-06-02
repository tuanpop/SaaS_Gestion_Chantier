import { z } from 'zod'

// SECURITY: K2.5-T-10 — schéma unique importé client ET serveur depuis ce fichier.
// Ne jamais redéfinir inline dans un composant ou une route API.

export const InviteUserSchema = z.object({
  prenom: z.string().min(1).max(100),
  nom: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal('')),
  telephone: z.string().max(20).optional(),
  role: z.enum(['admin', 'conducteur', 'ouvrier']),
})

export type InviteUserInput = z.infer<typeof InviteUserSchema>

export const PatchUserSchema = z.object({
  prenom: z.string().min(1).max(100).optional(),
  nom: z.string().min(1).max(100).optional(),
  telephone: z.string().max(20).nullable().optional(),
})

export type PatchUserInput = z.infer<typeof PatchUserSchema>
