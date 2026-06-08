// lib/validation/notifications.ts
// Schémas Zod pour les endpoints de notifications
// D-4V-009 : Zod strict sur UUID path param, cursor (ISO string optionnel), limit (int 1-20)
// K4V-05 : validation des claims uniquement via headers (jamais body)

import { z } from 'zod'

// ============================================================
// GET /api/notifications — query params
// ============================================================

export const GetNotificationsSchema = z
  .object({
    cursor: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(20),
  })
  .strict()

// ============================================================
// PATCH /api/notifications/[id]/read — path param
// ============================================================

export const PatchReadSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict()

// ============================================================
// Exports nommés
// ============================================================

export type GetNotificationsInput = z.infer<typeof GetNotificationsSchema>
export type PatchReadInput = z.infer<typeof PatchReadSchema>
