import { z } from 'zod'

export const CreateChantierSchema = z
  .object({
    nom: z.string().min(1).max(100),
    client_nom: z.string().min(1).max(200),
    adresse: z.string().min(1).max(500),
    code_postal: z.string().regex(/^\d{5}$/, 'Code postal : 5 chiffres requis'),
    budget_alloue: z.number().positive().optional(),
    date_debut: z.string().date(),
    date_fin_prevue: z.string().date(),
  })
  .refine((data) => data.date_fin_prevue >= data.date_debut, {
    message: 'date_fin_prevue doit être >= date_debut',
    path: ['date_fin_prevue'],
  })

export type CreateChantierInput = z.infer<typeof CreateChantierSchema>
