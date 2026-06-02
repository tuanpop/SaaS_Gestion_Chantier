// lib/validation/ouvrier.ts
// Schemas Zod pour les routes ouvrier Sprint 3
//
// SECURITE : PatchOuvrierTacheSchema utilise .strict() (D-3-022 BINDING).
// Le .strict() rejette TOUT champ inconnu, incluant note_privee_conducteur.
// Cette protection est le 4eme niveau de defense K3-CR-04 (injection via PATCH).
//
// Ne jamais supprimer le .strict() sans decision documentee dans DECISIONLOG.md.

import { z } from 'zod'
import type { OuvrierSession } from '@/types/database'

// ============================================================
// OuvrierSessionSchema — validation du JSON Redis (D-3-003)
// ============================================================
// Utilise pour valider le JSON parse de la valeur Redis a chaque hit.
// Si la validation echoue → session abandonnee (getOuvrierSession retourne null).

const OuvrierAffectationSchema = z.object({
  affectation_id: z.string().uuid(),
  chantier_id: z.string().uuid(),
  vue: z.enum(['mes_taches', 'chantier_complet']),
})

export const OuvrierSessionSchema = z.object({
  user_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  role: z.literal('ouvrier'),
  affectations: z.array(OuvrierAffectationSchema).min(0),
  created_at: z.number().int().positive(),
}) satisfies z.ZodType<OuvrierSession>

export type OuvrierSessionInput = z.infer<typeof OuvrierSessionSchema>

// ============================================================
// PatchOuvrierTacheSchema — PATCH /api/ouvrier/taches/[id]
// ============================================================
// D-3-022 BINDING : .strict() est OBLIGATOIRE.
// Rejette tout champ non declare, incluant note_privee_conducteur.
// K3-CR-04 : defense contre l'injection de champs sensibles via PATCH.
//
// bloque_raison : min 3 chars (specs ouvrier §4.5) — distinct de UpdateTacheSchema
// conducteur qui impose min 10 chars. Ces deux schemas sont intentionnellement distincts.

export const PatchOuvrierTacheSchema = z
  .object({
    statut: z.enum(['a_faire', 'en_cours', 'termine', 'bloque']),
    bloque_raison: z.string().min(3, 'Motif requis (min 3 caracteres)').max(1000).nullable().optional(),
  })
  .strict() // D-3-022 : rejette note_privee_conducteur + tout champ inconnu (K3-CR-04 BINDING)

export type PatchOuvrierTacheInput = z.infer<typeof PatchOuvrierTacheSchema>

// ============================================================
// NoAffectationDataSchema — validation du param base64 /ouvrier/no-affectation
// ============================================================
// Le parametre `data` de la page no-affectation est un JSON base64url encode
// contenant les infos du conducteur a contacter.
// Valide cote client dans la page pour eviter l'affichage de donnees corrompues
// (K3-MED-10 : validation Zod cote client).

export const NoAffectationDataSchema = z.object({
  conducteur_nom: z.string().min(1).max(200),
  conducteur_prenom: z.string().min(1).max(200),
  conducteur_telephone: z.string().max(30).nullable(),
  dernier_chantier_nom: z.string().min(1).max(200),
})

export type NoAffectationData = z.infer<typeof NoAffectationDataSchema>
