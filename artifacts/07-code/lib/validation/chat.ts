// lib/validation/chat.ts — Schémas Zod Sprint 8 Chat + Bot
// EXI-Y-K8-06 BINDING : PayloadX Zod .strict() — rejette toute clé non déclarée,
//   dont chantier_id/organisation_id (protection IDOR D-8-14).
// D-8-06 : pagination cursor, limit max 50 enforced.
// RG-CHAT-005 : contenu message 1-4000 chars.
// RG-ACTION-003 : payload éditable avant validation, Zod strict par type.
// V-8-07 : POST body avec type != 'user' → 400.

import { z } from 'zod'
import type { ActionType } from '@/types/chat'

// ============================================================
// POST /api/chantiers/[id]/chat/messages
// ============================================================

export const PostMessageBodySchema = z.object({
  contenu: z
    .string()
    .min(1, 'Le message ne peut pas être vide.')
    .max(4000, 'Le message ne peut pas dépasser 4000 caractères.'),
  // type : si présent et != 'user' → handler retourne 400 (D-8-03 / V-8-07)
  // Le type final est TOUJOURS forcé 'user' côté handler pour les humains.
  type: z.literal('user').optional(),
})

// ============================================================
// GET /api/chantiers/[id]/chat/messages
// Pagination cursor ASC (D-8-06 / RG-CHAT-010)
// ============================================================

export const GetMessagesQuerySchema = z.object({
  // cursor = created_at ISO string du message le plus ancien chargé (pour scroll vers le haut)
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 50))
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(50, 'La limite maximale est de 50 messages.'),
    ),
})

// ============================================================
// GET /api/chantiers/[id]/action-proposals
// ============================================================

export const GetProposalsQuerySchema = z.object({
  statut: z
    .enum(['pending', 'valide', 'rejete', 'execute'])
    .optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 20))
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(50, 'La limite maximale est de 50 propositions.'),
    ),
  cursor: z.string().optional(),
})

// ============================================================
// PATCH /api/action-proposals/[id]/payload — Payload par type d'action
// EXI-Y-K8-06 BINDING : .strict() rejette toute clé non déclarée
// D-8-14 BINDING : chantier_id/organisation_id INTERDITS dans ces schémas
// ============================================================

// Type 1 : créer_tache
export const PayloadCreerTacheSchema = z
  .object({
    titre: z
      .string()
      .min(1, 'Le titre est obligatoire.')
      .max(200, 'Le titre ne peut pas dépasser 200 caractères.'),
    description: z
      .string()
      .max(500, 'La description ne peut pas dépasser 500 caractères.')
      .optional(),
    assigned_to: z.string().uuid('assigned_to doit être un UUID valide.').nullable().optional(),
    date_echeance: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date_echeance doit être au format YYYY-MM-DD.')
      .optional(),
  })
  .strip() // Rejette toute clé supplémentaire (dont chantier_id/organisation_id — EXI-Y-K8-06)

// Type 2 : ajouter_cr
export const PayloadAjouterCRSchema = z
  .object({
    note: z
      .string()
      .min(1, 'La note est obligatoire.')
      .max(500, 'La note ne peut pas dépasser 500 caractères.'),
  })
  .strip()

// Type 3 : replanifier
// F004 fix — ressource_id nullable aligné sur schéma Yuki (schema.ts l.158 : .nullable())
// Cas RG-ACTION-006 : tâche non identifiable → ressource_id null → erreur métier dans executerAction
// (conducteur doit sélectionner la tâche manuellement via l'UI)
export const PayloadReplanifierSchema = z
  .object({
    cible: z.enum(['tache', 'chantier']),
    ressource_id: z.string().uuid('ressource_id doit être un UUID valide.').nullable(),
    nouvelle_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'nouvelle_date doit être au format YYYY-MM-DD.'),
    raison: z
      .string()
      .max(200, 'La raison ne peut pas dépasser 200 caractères.')
      .optional(),
  })
  .strip()

// Type 4 : alerte
export const PayloadAlerteSchema = z
  .object({
    titre: z
      .string()
      .min(1, 'Le titre est obligatoire.')
      .max(150, 'Le titre ne peut pas dépasser 150 caractères.'),
    message: z
      .string()
      .min(1, 'Le message est obligatoire.')
      .max(500, 'Le message ne peut pas dépasser 500 caractères.'),
    destinataires: z.enum(['admins', 'conducteurs', 'tous']),
  })
  .strip()

// ============================================================
// Dispatcher : valide le payload selon le type d'action
// Retourne le payload validé ou null si invalide
// EXI-Y-K8-06 : .strict() sur chaque schéma — chantier_id/organisation_id → rejeté
// ============================================================

export type PayloadSchemaResult =
  | { success: true; data: ReturnType<typeof PayloadCreerTacheSchema.parse> }
  | { success: true; data: ReturnType<typeof PayloadAjouterCRSchema.parse> }
  | { success: true; data: ReturnType<typeof PayloadReplanifierSchema.parse> }
  | { success: true; data: ReturnType<typeof PayloadAlerteSchema.parse> }
  | { success: false; error: z.ZodError }

export function validatePayloadByType(
  type: ActionType,
  payload: unknown,
): { success: boolean; data?: unknown; error?: z.ZodError } {
  // EXI-Y-K8-06 / D-8-14 : rejeter explicitement l'injection de clés tenant/identité.
  // Les schémas utilisent .strip() (tolère les clés bénignes hallucinées par le LLM, ex.
  // statut, qui sont simplement ignorées) ; cette garde reste la protection IDOR.
  // executerAction force déjà chantier_id/organisation_id côté serveur (défense en profondeur).
  const FORBIDDEN_PAYLOAD_KEYS = ['chantier_id', 'organisation_id', 'org_id', 'id']
  if (
    typeof payload === 'object' &&
    payload !== null &&
    FORBIDDEN_PAYLOAD_KEYS.some((k) => k in (payload as Record<string, unknown>))
  ) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [],
          message:
            'Clé interdite (chantier_id/organisation_id/id) dans le payload — rejeté (EXI-Y-K8-06).',
        },
      ]),
    }
  }

  switch (type) {
    case 'creer_tache': {
      const result = PayloadCreerTacheSchema.safeParse(payload)
      return result
    }
    case 'ajouter_cr': {
      const result = PayloadAjouterCRSchema.safeParse(payload)
      return result
    }
    case 'replanifier': {
      const result = PayloadReplanifierSchema.safeParse(payload)
      return result
    }
    case 'alerte': {
      const result = PayloadAlerteSchema.safeParse(payload)
      return result
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = type
      return { success: false, error: new z.ZodError([{
        code: z.ZodIssueCode.invalid_type,
        expected: 'string',
        received: 'undefined',
        path: ['type'],
        message: `Type d'action inconnu : ${String(_exhaustive)}`,
      }]) }
    }
  }
}
