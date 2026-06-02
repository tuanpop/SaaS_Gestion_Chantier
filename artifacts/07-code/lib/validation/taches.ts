import { z } from 'zod'

// SECURITY: K2.5-T-10 — schémas uniques importés client ET serveur depuis ce fichier.
// Ne jamais redéfinir inline dans un composant ou une route API.

export const CreateTacheSchema = z
  .object({
    titre: z.string().min(1, 'Le titre est requis').max(200, 'Max 200 caractères'),
    description: z.string().max(2000).optional(),
    date_echeance: z.string().date().nullable().optional(),
    statut: z.enum(['a_faire', 'en_cours', 'bloque']).default('a_faire'),
    assigned_to: z.string().uuid().nullable().optional(),
    bloque_raison: z
      .string()
      .min(10, 'Raison obligatoire si tâche bloquée (min 10 caractères)')
      .nullable()
      .optional(),
  })
  .refine(
    (data) => {
      if (data.statut === 'bloque') {
        return (
          data.bloque_raison !== null &&
          data.bloque_raison !== undefined &&
          data.bloque_raison.length >= 10
        )
      }
      return true
    },
    {
      message: 'bloque_raison obligatoire (min 10 car.) si statut=bloque',
      path: ['bloque_raison'],
    },
  )

export type CreateTacheInput = z.infer<typeof CreateTacheSchema>

export const UpdateTacheSchema = z
  .object({
    titre: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    statut: z.enum(['a_faire', 'en_cours', 'termine', 'bloque']).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    date_echeance: z.string().date().nullable().optional(),
    bloque_raison: z.string().min(10).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.statut === 'bloque') {
        return (
          data.bloque_raison !== null &&
          data.bloque_raison !== undefined &&
          data.bloque_raison.length >= 10
        )
      }
      return true
    },
    {
      message: 'bloque_raison obligatoire (min 10 car.) si statut=bloque',
      path: ['bloque_raison'],
    },
  )

export type UpdateTacheInput = z.infer<typeof UpdateTacheSchema>
