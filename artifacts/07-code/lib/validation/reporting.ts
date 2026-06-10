// lib/validation/reporting.ts — Schémas Zod Sprint 5 Reporting
// StatutCRValues : constante des statuts valides (référencée par les tests TST-K5-03)
// TST-K5-09 : PatchCrBodySchema et PatchHebdoBodySchema DOIVENT utiliser .strict()
// pour rejeter tout champ extra (statut, date_cr, chantier_id, organisation_id, valide_par)
// SURF-5-07 Kakashi : protection mass-assignment

import { z } from 'zod'

// ============================================================
// Génération manuelle CR
// ============================================================

/**
 * Body POST /api/chantiers/[id]/cr/generer
 * date_cr optionnel — défaut = date du jour UTC côté handler
 */
export const GenererCrBodySchema = z.object({
  date_cr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date attendu : YYYY-MM-DD').optional(),
})

export type GenererCrBody = z.infer<typeof GenererCrBodySchema>

// ============================================================
// Édition brouillon CR (PATCH)
// ============================================================

/**
 * Body PATCH /api/cr/[id]
 * .strict() : seul contenu_genere accepté — tout autre champ est rejeté (TST-K5-09)
 * Champs immuables après création :
 *   - statut (transitions via endpoints dédiés /valider /envoyer)
 *   - date_cr (immuable)
 *   - chantier_id (FK structurelle)
 *   - organisation_id (tenant)
 *   - valide_par (posé par jwt.sub côté serveur)
 */
export const PatchCrBodySchema = z
  .object({
    contenu_genere: z
      .string()
      .min(1, 'Le contenu ne peut pas être vide')
      .max(50_000, 'Le contenu ne doit pas dépasser 50 000 caractères'),
  })
  .strict()

export type PatchCrBody = z.infer<typeof PatchCrBodySchema>

// ============================================================
// Génération rapport hebdo
// ============================================================

/**
 * Body POST /api/chantiers/[id]/rapports-hebdo/generer
 * annee_iso : entier 2020-2100
 * semaine_iso : entier 1-53
 */
export const GenererHebdoBodySchema = z.object({
  annee_iso: z
    .number()
    .int()
    .min(2020, 'Année ISO minimum : 2020')
    .max(2100, 'Année ISO maximum : 2100'),
  semaine_iso: z
    .number()
    .int()
    .min(1, 'Semaine ISO minimum : 1')
    .max(53, 'Semaine ISO maximum : 53'),
})

export type GenererHebdoBody = z.infer<typeof GenererHebdoBodySchema>

// ============================================================
// Édition brouillon rapport hebdo (PATCH)
// ============================================================

/**
 * Body PATCH /api/rapports-hebdo/[id]
 * .strict() : seul contenu_genere accepté (miroir PatchCrBodySchema — F002 Itachi corrigé)
 */
export const PatchHebdoBodySchema = z
  .object({
    contenu_genere: z
      .string()
      .min(1, 'Le contenu ne peut pas être vide')
      .max(50_000, 'Le contenu ne doit pas dépasser 50 000 caractères'),
  })
  .strict()

export type PatchHebdoBody = z.infer<typeof PatchHebdoBodySchema>

// ============================================================
// Pagination liste CR
// ============================================================

/**
 * Query params GET /api/chantiers/[id]/cr
 * cursor : date ISO (cursor sur date_cr DESC)
 * limit : max 50 enforced
 * statut : filtre optionnel
 */
export const GetCrListQuerySchema = z.object({
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(
      z.number().int().min(1, 'Limite minimum : 1').max(50, 'Limite maximum : 50 (specs §6.3)'),
    ),
  statut: z.enum(['brouillon', 'valide', 'envoye']).optional(),
})

export type GetCrListQuery = z.infer<typeof GetCrListQuerySchema>

// ============================================================
// Pagination liste rapport hebdo
// ============================================================

export const GetHebdoListQuerySchema = z.object({
  cursor_annee: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined)),
  cursor_semaine: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = v ? parseInt(v, 10) : 20
      if (isNaN(n) || n < 1) return 20
      return Math.min(n, 50)
    }),
})

export type GetHebdoListQuery = z.infer<typeof GetHebdoListQuerySchema>

// ============================================================
// Validation header cron secret
// ============================================================

/**
 * Schéma de validation du header x-cron-secret
 * Utilisé pour valider la présence et le format du secret cron.
 * La comparaison timing-safe est effectuée dans le handler (pas ici).
 */
export const CronSecretHeaderSchema = z.object({
  'x-cron-secret': z.string().min(1, 'x-cron-secret requis'),
})

export type CronSecretHeader = z.infer<typeof CronSecretHeaderSchema>

// ============================================================
// Constantes pour tests (D-007 workflow)
// ============================================================

/** Valeurs valides pour le statut CR (D-007 BINDING — immuables hors transitions dédiées) */
export const StatutCRValues = ['brouillon', 'valide', 'envoye'] as const
