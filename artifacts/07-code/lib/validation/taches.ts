import { z } from 'zod'

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
