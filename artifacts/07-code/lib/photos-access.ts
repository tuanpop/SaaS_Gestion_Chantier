// lib/photos-access.ts
// SERVEUR UNIQUEMENT — Node runtime obligatoire (D-4-015)
// Helper RBAC central — FICHIER SECURITE CRITIQUE (K4-MED-12)
//
// Exporte :
//   resolvePhotoActor(request)     — D-4-002/D-4-014/ADR-4-005 : JWT getUser() d'abord, cookie ouvrier ensuite
//   canDeletePhoto(actor, photo)   — D-4-002 : auteur OU staff meme org
//   signPhotoPaths(paths[])        — D-4-004 : batch createSignedUrls TTL 3600s
//   validateImageBuffer(buf, mime) — D-4-005/K4-CR-01 : whitelist MIME + magic-bytes + taille <= 10 Mo
//
// DECISIONS BINDING :
//   D-4-014/ADR-4-005 (resolution F004/K4-HI-02) :
//     resolvePhotoActor RE-VALIDE le JWT via createClient()+getUser() handler-level.
//     NE LIT JAMAIS les headers x-user-role / x-organisation-id / x-user-id comme source d'identite.
//     Ces headers sont forgeables (le middleware ne les strippe pas — verifie middleware.ts lignes 82-92).
//
//   D-4-005/PO-4-02 amende 2026-06-07 (A1 HEIC RETIRE) :
//     Whitelist stricte JPEG/PNG/WebP UNIQUEMENT. HEIC rejete.
//
//   D-4-004 : signPhotoPaths utilise createSignedUrls (pluriel, 1 round-trip pour N chemins).
//
//   K4-MED-04 : signed_url/storage_path jamais loggues en clair (pino redact actif sur ces champs).

import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { logger } from '@/lib/logger'
import type { Photo } from '@/types/database'

// ============================================================
// Type PhotoActor — discrimine ouvrier vs staff (D-4-002)
// ============================================================

export type PhotoActor =
  | { kind: 'ouvrier'; userId: string; organisationId: string }
  | { kind: 'staff'; userId: string; organisationId: string; role: 'conducteur' | 'admin' }

// ============================================================
// resolvePhotoActor — D-4-002/D-4-014/ADR-4-005 (SECURITE CRITIQUE K4-HI-02)
// ============================================================
//
// BINDING : chemin staff RE-VALIDE le JWT via getUser() — JAMAIS via x-*.
// Ordre : (1) JWT Supabase SSR (getUser) → staff si role ∈ {conducteur, admin}.
//         (2) Cookie ouvrier_session Postgres (getOuvrierSession).
//         (3) null → le handler retourne 401.
//
// Pourquoi getUser() et pas les x-headers ?
//   Le middleware.ts propage new Headers(request.headers) tel quel (lignes 82-92) sans
//   stripper les x-* entrants. Un client peut forger x-user-role: admin. getUser() valide
//   le JWT cote serveur — la seule garantie d'identite staff (ADR-4-005).
//
// TST-K4-11 : x-user-role: admin forge SANS JWT valide → resolvePhotoActor retourne null
//             (getUser() ne trouve pas d'utilisateur) → handler retourne 401.
// TST-K4-12 : cookie ouvrier + x-user-role: conducteur forge → chemin staff echoue
//             (getUser() retourne null car pas de JWT) → chemin ouvrier resolu → auteur uniquement.

export async function resolvePhotoActor(request: NextRequest): Promise<PhotoActor | null> {
  // 1) Chemin staff — VALIDER le JWT (pas lire x-*)
  //    createClient() lit la session Supabase SSR depuis les cookies ; getUser() verifie le JWT cote serveur.
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const role = user.app_metadata?.['role'] as string | undefined
      const orgId = user.app_metadata?.['organisation_id'] as string | undefined
      if (orgId && (role === 'conducteur' || role === 'admin')) {
        return {
          kind: 'staff',
          userId: user.id,
          organisationId: orgId,
          role: role as 'conducteur' | 'admin',
        }
      }
    }
  } catch (err) {
    // createClient() peut echouer si env vars absentes — non-bloquant pour le chemin ouvrier
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'resolvePhotoActor: createClient() erreur — fallback chemin ouvrier',
    )
  }

  // 2) Chemin ouvrier — cookie Postgres valide handler-level (D-3-002)
  const session = await getOuvrierSession(request)
  if (session) {
    return {
      kind: 'ouvrier',
      userId: session.user_id,
      organisationId: session.organisation_id,
    }
  }

  // 3) Aucun acteur valide → 401 cote handler
  return null
}

// ============================================================
// canDeletePhoto — D-4-002 : ouvrier auteur OU staff meme org
// ============================================================
//
// L'organisationId de l'acteur vient TOUJOURS d'une source verifiee
// (JWT getUser() ou cookie) — JAMAIS du body/query ni d'un header x-*.

export function canDeletePhoto(
  actor: PhotoActor,
  photo: Pick<Photo, 'uploader_id' | 'organisation_id'>,
): boolean {
  if (actor.kind === 'staff') {
    // Staff : meme organisation suffit (moderation conducteur/admin PO-4-01)
    return photo.organisation_id === actor.organisationId
  }
  // Ouvrier : doit etre l'auteur ET meme organisation (defense en profondeur)
  return photo.uploader_id === actor.userId && photo.organisation_id === actor.organisationId
}

// ============================================================
// signPhotoPaths — D-4-004 : batch 1 round-trip pour N chemins
// ============================================================
//
// Utilise createSignedUrls (pluriel — batch) et NON N appels createSignedUrl (singulier).
// TTL 3600s = 1h (PO-4-03 BINDING).
// Retourne une Map storage_path -> signed_url.
// K4-MED-04 : signed_url jamais loguee (pino redact actif sur le champ 'signed_url').
//
// Appele avec un tableau vide (aucune photo) → retourne Map vide sans appel reseau.

export async function signPhotoPaths(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()

  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from('photos')
    .createSignedUrls(paths, 3600)

  if (error || !data) {
    logger.warn(
      { err: error?.message ?? 'no data', pathCount: paths.length },
      'signPhotoPaths: erreur createSignedUrls',
    )
    return new Map()
  }

  const map = new Map<string, string>()
  for (const r of data) {
    // r.path et r.signedUrl sont les cles retournees par Supabase Storage
    if (r.signedUrl && r.path) {
      map.set(r.path, r.signedUrl)
    }
  }

  return map
}

// ============================================================
// validateImageBuffer — D-4-005/K4-CR-01 (WHITELIST STRICTE)
// ============================================================
//
// PO-4-02 amende 2026-06-07 (A1 HEIC RETIRE — BINDING) :
//   Whitelist STRICTE : JPEG, PNG, WebP UNIQUEMENT.
//   HEIC rejete cote serveur (et validation client hint formats).
//   GIF, SVG, PDF, HEIC, tout autre MIME → false.
//
// Validation simultanee (D-4-005) :
//   (A) MIME declared ∈ {image/jpeg, image/png, image/webp}
//   (B) magic-bytes du buffer correspondent au MIME declare (anti-polyglot)
//   (C) taille <= 10 485 760 octets (10 Mo)
//
// Echec d'une condition → { ok: false } SANS aucun upload.
// Succes → { ok: true, ext: 'jpg'|'png'|'webp' }
//
// Magic bytes (specs §3.2) :
//   image/jpeg  : FF D8 FF
//   image/png   : 89 50 4E 47
//   image/webp  : 52 49 46 46 __ __ __ __ 57 45 42 50  (RIFF....WEBP)

const MAX_SIZE = 10_485_760 // 10 Mo

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function validateImageBuffer(
  buf: Buffer,
  declaredMime: string,
): { ok: true; ext: string } | { ok: false; error: string } {
  // (A) MIME dans la whitelist
  if (!ALLOWED_MIMES.has(declaredMime)) {
    return {
      ok: false,
      error: `Format non supporte. Formats acceptes : JPEG, PNG, WebP. Recu : ${declaredMime}`,
    }
  }

  // (C) Taille
  if (buf.length > MAX_SIZE) {
    return {
      ok: false,
      error: `Le fichier depasse la taille maximale de 10 Mo (${buf.length} octets).`,
    }
  }

  if (buf.length < 12) {
    // Buffer trop court pour lire les magic bytes
    return { ok: false, error: 'Fichier trop petit pour etre une image valide.' }
  }

  // (B) Magic bytes — verification cote handler AVANT Storage (K4-CR-01 BINDING)
  const magicOk = checkMagicBytes(buf, declaredMime)
  if (!magicOk) {
    return {
      ok: false,
      error: `Le contenu du fichier ne correspond pas au format declare (${declaredMime}).`,
    }
  }

  const ext = MIME_TO_EXT[declaredMime]
  if (!ext) {
    // Ne devrait jamais arriver si ALLOWED_MIMES est coherent avec MIME_TO_EXT
    return { ok: false, error: `Extension inconnue pour ${declaredMime}.` }
  }

  return { ok: true, ext }
}

/**
 * Verifie les magic bytes du buffer selon le MIME declare.
 * Retourne true si le buffer correspond au MIME, false sinon.
 */
function checkMagicBytes(buf: Buffer, mime: string): boolean {
  switch (mime) {
    case 'image/jpeg':
      // JPEG : FF D8 FF (3 premiers octets)
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff

    case 'image/png':
      // PNG : 89 50 4E 47 0D 0A 1A 0A (8 premiers octets)
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      )

    case 'image/webp':
      // WebP : RIFF (52 49 46 46) + 4 octets taille + WEBP (57 45 42 50)
      // Positions 0-3 = "RIFF", positions 8-11 = "WEBP"
      return (
        buf[0] === 0x52 &&  // R
        buf[1] === 0x49 &&  // I
        buf[2] === 0x46 &&  // F
        buf[3] === 0x46 &&  // F
        buf[8] === 0x57 &&  // W
        buf[9] === 0x45 &&  // E
        buf[10] === 0x42 && // B
        buf[11] === 0x50    // P
      )

    default:
      return false
  }
}
