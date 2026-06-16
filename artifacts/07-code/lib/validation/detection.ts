// lib/validation/detection.ts — Schémas Zod Sprint 6 IA Dérive
//
// Sécurité :
//   EXI-Y-K6-07 / TST-K6-17/25/30 BINDING : ratio_budget >= 0.50 (PAS > 0).
//     La borne inférieure 0.50 est imposée par Kakashi pour éviter :
//     - DoS économique LLM (seuil plancher → tout chantier en dérive → LLM massif)
//     - Flood de notifications (TST-K6-25)
//     Un ratio_budget < 50% n'a aucun sens métier BTP.
//   TST-K6-20 : .strict() sur PatchSeuilsDerivesSchema — tout champ extra → 400
//     (anti-mass-assignment, specs §6.5).
//   TST-K6-17 : jours_blocage/jours_inactivite = entier strict (.int().min(1)).

import { z } from 'zod'

// ============================================================
// PatchSeuilsDerivesSchema — PATCH /api/organisations/me/seuils-derives
// EXI-Y-K6-07 BINDING : ratio_budget ∈ [0.50, 1) — borne inf 0.50 imposée par Kakashi
// TST-K6-20 : .strict() — tout champ extra rejeté avec 400
// ============================================================

export const PatchSeuilsDerivesSchema = z
  .object({
    ratio_budget: z
      .number()
      .min(0.50, {
        // Message explicite obligatoire (specs §6.5) — affiché dans les erreurs 400
        message: 'ratio_budget doit être compris entre 50% et 99% inclus (borne sécurité)',
      })
      .max(0.9999, {
        message: 'ratio_budget doit être compris entre 50% et 99% inclus (borne sécurité)',
      })
      .optional(),
    jours_blocage: z
      .number()
      .int({ message: 'jours_blocage doit être un entier' })
      .min(1, { message: 'jours_blocage doit être supérieur ou égal à 1' })
      .optional(),
    jours_inactivite: z
      .number()
      .int({ message: 'jours_inactivite doit être un entier' })
      .min(1, { message: 'jours_inactivite doit être supérieur ou égal à 1' })
      .optional(),
  })
  // TST-K6-20 : tout champ non déclaré ci-dessus → 400 (anti-mass-assignment)
  .strict()
  // Au moins 1 champ fourni — un PATCH vide → 400
  .refine(
    (data) => {
      return (
        data.ratio_budget !== undefined ||
        data.jours_blocage !== undefined ||
        data.jours_inactivite !== undefined
      )
    },
    {
      message: 'Au moins un champ (ratio_budget, jours_blocage, jours_inactivite) doit être fourni.',
    },
  )

export type PatchSeuilsDerivesInput = z.infer<typeof PatchSeuilsDerivesSchema>

// ============================================================
// DerivesQuerySchema — GET /api/chantiers/[id]/derives
// cursor-based pagination (jamais offset — specs §7)
// limit max 50 enforced server-side (specs §6.2)
// ============================================================

export const DerivesQuerySchema = z.object({
  // cursor = ISO timestamp detected_at du dernier item reçu
  cursor: z.string().datetime({ message: 'cursor doit être un timestamp ISO 8601' }).optional(),
  // limit 1–50, défaut 20
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(50, { message: 'limit max 50 enforced server-side' }),
    )
    .optional()
    .default('20'),
  // actif = true → resolved_at IS NULL (défaut) ; false → toutes (résolues incluses)
  actif: z
    .string()
    .transform((v) => v === 'true')
    .optional()
    .default('true'),
})

export type DerivesQueryInput = z.infer<typeof DerivesQuerySchema>

// ============================================================
// DerivesConsolideeQuerySchema — GET /api/derives (vue consolidée admin)
// cursor-based pagination, limit max 50
// ============================================================

export const DerivesConsolideeQuerySchema = z.object({
  cursor: z.string().datetime({ message: 'cursor doit être un timestamp ISO 8601' }).optional(),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(50, { message: 'limit max 50 enforced server-side' }),
    )
    .optional()
    .default('20'),
})

export type DerivesConsolideeQueryInput = z.infer<typeof DerivesConsolideeQuerySchema>
