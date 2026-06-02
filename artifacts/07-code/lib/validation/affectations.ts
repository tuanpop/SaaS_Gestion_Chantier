import { z } from 'zod'

// SECURITY: K2.5-T-10 — schéma unique importé client ET serveur depuis ce fichier.
// Ne jamais redéfinir inline dans un composant ou une route API.

export const CreateAffectationSchema = z
  .object({
    user_id: z.string().uuid('Membre invalide'),
    date_debut: z.string().date('Date de début invalide'),
    date_fin: z.string().date().nullable().optional(),
  })
  .refine(
    (d) => !d.date_fin || d.date_fin >= d.date_debut,
    { message: 'Date de fin >= date de début requise', path: ['date_fin'] },
  )

export type CreateAffectationInput = z.infer<typeof CreateAffectationSchema>
