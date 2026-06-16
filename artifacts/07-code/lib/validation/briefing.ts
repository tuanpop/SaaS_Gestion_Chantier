// lib/validation/briefing.ts — Schémas Zod pour les endpoints briefings Sprint 7
// Pagination cursor-based uniquement (jamais offset — CLAUDE.md hard rule)
// limit max 20 enforced server-side (specs §6.2 / §6.3)

import { z } from 'zod'

// ============================================================
// GET /api/chantiers/[id]/briefings — query params
// limit: 1–20, défaut 10 enforced server-side
// cursor: ISO timestamp optionnel pour pagination created_at < cursor
// ============================================================

export const GetChantierBriefingsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 10))
    .pipe(z.number().int().min(1).max(20)),
  cursor: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || !isNaN(Date.parse(v)),
      { message: 'cursor doit être un ISO timestamp valide' },
    ),
})

export type GetChantierBriefingsQuery = z.infer<typeof GetChantierBriefingsQuerySchema>

// ============================================================
// GET /api/briefings — query params (vue consolidée admin)
// limit: 1–20, défaut 10
// cursor: ISO timestamp optionnel
// Filtres optionnels : chantier_id (uuid), semaine_iso (1–53), annee_iso (>= 2024)
// Tous les filtres optionnels sont TOUJOURS combinés au filtre org (TST-K7-20)
// ============================================================

export const GetBriefingsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 10))
    .pipe(z.number().int().min(1).max(20)),
  cursor: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || !isNaN(Date.parse(v)),
      { message: 'cursor doit être un ISO timestamp valide' },
    ),
  chantier_id: z
    .string()
    .uuid({ message: 'chantier_id doit être un UUID valide' })
    .optional(),
  semaine_iso: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(1).max(53).optional()),
  annee_iso: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(2024).optional()),
})

export type GetBriefingsQuery = z.infer<typeof GetBriefingsQuerySchema>
