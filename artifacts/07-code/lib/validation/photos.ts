// lib/validation/photos.ts
// Schemas Zod Sprint 4 — photos upload et commentaire
//
// D-4-003 : PatchCommentaireSchema avec .strict() (Zod strict — rejette champs inconnus)
// D-4-005 : UploadFormSchema pour les champs non-fichier du multipart
// K4-MED-10 : .strict() sur PATCH pour bloquer { commentaire, storage_path } -> 400

import { z } from 'zod'

// ============================================================
// PatchCommentaireSchema — PATCH /api/photos/[id]
// ============================================================
//
// D-4-003 : commentaire editablepost-upload (auteur uniquement).
// .strict() : tout champ inconnu (ex: storage_path, tache_id) -> 400 (K4-MED-10 BINDING).
// TST-K4-16 : PATCH { commentaire, storage_path: '../x' } -> 400.
//
// Le champ 'commentaire' est REQUIS (une PATCH sans champ = 400).
// null = supprime le commentaire existant.

export const PatchCommentaireSchema = z.object({
  commentaire: z
    .string()
    .max(500, 'Le commentaire ne peut pas depasser 500 caracteres.')
    .nullable(),
}).strict()

export type PatchCommentaireInput = z.infer<typeof PatchCommentaireSchema>

// ============================================================
// UploadFormSchema — POST /api/photos (champs non-fichier du multipart)
// ============================================================
//
// Valide tache_id (UUID) et commentaire optionnel depuis le FormData.
// Le fichier lui-meme est valide separement par validateImageBuffer (lib/photos-access.ts).
// K4-LOW-01 : organisation_id TOUJOURS depuis la session, JAMAIS du body.

export const UploadFormSchema = z.object({
  tache_id: z
    .string({ required_error: 'Le champ tache_id est requis.' })
    .uuid('Le champ tache_id doit etre un UUID valide.'),
  commentaire: z
    .string()
    .max(500, 'Le commentaire ne peut pas depasser 500 caracteres.')
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? null))),
})

export type UploadFormInput = z.infer<typeof UploadFormSchema>
