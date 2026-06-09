// app/api/photos/route.ts
// POST /api/photos — Upload photo ouvrier sur une tache (S4-F01, D-4-001)
//
// Implemente : US-4.1, RG-PHOTO-001 a 008
// Auth : Cookie ouvrier_session (getOuvrierSession) — ouvrier UNIQUEMENT
// Items securite :
//   D-4-001 : upload PROXIFIE via Route Handler + service_role (jamais client -> Storage direct)
//   D-4-005 : validation magic-bytes + MIME + taille AVANT Storage (K4-CR-01 BINDING)
//   D-4-006 : storage_path construit serveur uniquement, jamais expose en reponse (K4-MED-01)
//   D-4-015 : runtime = 'nodejs' (Storage SDK + getOuvrierSession non compatibles Edge)
//   D-4-016 : organisation_id depuis session uniquement (K4-LOW-01)
//   K4-CR-03 : rate-limit 20 uploads/ouvrier/h BINDING via lib/cache.ts
//   K4-HI-01 : IDOR check tache assigned_to + organisation_id (SELECT explicite)
//   K4-MED-01 : storage_path JAMAIS dans la reponse 201
//   K4-MED-02 : rollback Storage best-effort si INSERT DB KO (RG-PHOTO-004)
//
// Sequenceur (archi §3.3 BINDING) :
//   1. getOuvrierSession -> 401
//   2. formData() -> extraire tache_id, file, commentaire
//   3. UploadFormSchema.safeParse -> 400
//   4. file absent -> 400
//   5. validateImageBuffer(buf, mime) -> 400 si KO (aucun upload encore)
//   6. checkRateLimit 20/h -> 429
//   7. IDOR check tache assigned_to + org -> 403/404
//   8. storage_path = {org}/{tache}/{photoId}.{ext} (construit serveur — D-4-006)
//   9. adminClient.storage.upload -> 502
//  10. INSERT photos -> rollback Storage best-effort + 500 si KO
//  11. signPhotoPaths([storage_path]) -> 201 PhotoOuvrierDisplay (sans storage_path)

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import { validateImageBuffer, signPhotoPaths } from '@/lib/photos-access'
import { checkRateLimit, RATE_LIMITS } from '@/lib/cache'
import { UploadFormSchema } from '@/lib/validation/photos'
import { logger } from '@/lib/logger'
import type { PhotoOuvrierDisplay } from '@/types/database'

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = logger.child({ correlationId, route: 'POST /api/photos' })

  try {
    // Etape 1 — Auth ouvrier (cookie Postgres — D-3-002, D-4-001)
    const session = await getOuvrierSession(request)
    if (!session) {
      return NextResponse.json(
        { error: 'Session expirée. Reconnectez-vous.' },
        { status: 401 },
      )
    }

    // Etape 2 — Parser le multipart form
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        { error: 'Corps de requête invalide. Multipart/form-data attendu.' },
        { status: 400 },
      )
    }

    const rawTacheId = formData.get('tache_id')
    const rawFile = formData.get('file')
    const rawCommentaire = formData.get('commentaire')

    // Etape 3 — Validation Zod des champs non-fichier
    const parsed = UploadFormSchema.safeParse({
      tache_id: typeof rawTacheId === 'string' ? rawTacheId : undefined,
      commentaire: typeof rawCommentaire === 'string' ? rawCommentaire : null,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Données invalides.', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    // Etape 4 — Fichier present
    if (!rawFile || !(rawFile instanceof Blob)) {
      return NextResponse.json(
        { error: 'Un fichier est requis.' },
        { status: 400 },
      )
    }

    const file = rawFile as File
    const declaredMime = file.type

    // Etape 5a — Rejet taille AVANT bufferisation (K4-CR-03 BINDING — DoS memoire)
    // Blob.size est disponible avant arrayBuffer() — evite de charger >10 Mo en RAM
    const MAX_UPLOAD_SIZE = 10_485_760 // 10 Mo
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: `Le fichier depasse la taille maximale de 10 Mo (${file.size} octets).` },
        { status: 400 },
      )
    }

    // Lire le buffer complet en memoire (D-4-001 : proxy serveur)
    // Taille deja verifiee ci-dessus — le buffer est <= 10 Mo (K4-CR-03)
    const arrayBuffer = await file.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)

    // Etape 5b — Validation magic-bytes + MIME + taille (D-4-005, K4-CR-01 BINDING)
    // validateImageBuffer re-verifie la taille sur le buffer reel (defense en profondeur)
    // AVANT tout appel Storage — echec = 400, aucun fichier uploade
    const validation = validateImageBuffer(buf, declaredMime)
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      )
    }

    // Etape 6 — Rate-limit 20 uploads/ouvrier/h (K4-CR-03 BINDING)
    const rateLimitKey = `ratelimit:upload:${session.user_id}`
    const rl = checkRateLimit({
      key: rateLimitKey,
      limit: RATE_LIMITS.photoUpload.limit,
      windowMs: RATE_LIMITS.photoUpload.windowMs,
    })
    if (!rl.allowed) {
      reqLogger.warn(
        { userId: session.user_id },
        'Rate limit upload atteint (20/h) — 429 (K4-CR-03)',
      )
      return NextResponse.json(
        { error: 'Limite d\'upload atteinte (20 photos par heure). Réessayez plus tard.' },
        { status: 429 },
      )
    }

    const adminClient = createAdminClient()
    const { tache_id: tacheId, commentaire } = parsed.data

    // Etape 7 — IDOR check : tache assigned_to = session.user_id + meme organisation (K4-HI-01)
    // SELECT explicite — defence en profondeur (D-3-004)
    const { data: tacheCheck, error: tacheError } = await adminClient
      .from('taches')
      .select('id, assigned_to')
      .eq('id', tacheId)
      .eq('organisation_id', session.organisation_id) // K4-HI-01 : organisation BINDING
      // NB : `taches` est en HARD delete — PAS de colonne `deleted_at`. Ne jamais filtrer
      // dessus ici (provoquait 42703 "column taches.deleted_at does not exist" → upload KO).
      .maybeSingle()

    if (tacheError) {
      reqLogger.error({ err: tacheError.message, tacheId }, 'POST /api/photos : erreur SELECT tache')
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    if (!tacheCheck) {
      // Tache inexistante OU hors organisation — 404 (ne revele pas l'existence cross-org)
      return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404 })
    }

    if (tacheCheck.assigned_to !== session.user_id) {
      // Tache existe dans l'org mais pas assignee a cet ouvrier — 403 (IDOR check RG-PHOTO-001)
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }

    // Etape 8 — Construire storage_path serveur (D-4-006 — jamais depuis le client)
    const photoId = crypto.randomUUID()
    const ext = validation.ext  // 'jpg' | 'png' | 'webp' — derive du MIME valide
    const storagePath = `${session.organisation_id}/${tacheId}/${photoId}.${ext}`

    // Etape 9 — Upload Storage via service_role (D-4-001, ADR-4-001)
    const { error: storageError } = await adminClient.storage
      .from('photos')
      .upload(storagePath, buf, {
        contentType: declaredMime,
        upsert: false,  // interdire l'ecrasement (defense en profondeur)
      })

    if (storageError) {
      reqLogger.error(
        { err: storageError.message, userId: session.user_id },
        'POST /api/photos : erreur Storage upload',
      )
      return NextResponse.json(
        { error: 'Erreur lors de l\'envoi du fichier. Réessayez.' },
        { status: 502 },
      )
    }

    // Etape 10 — INSERT photos (colonnes explicites — D-3-004)
    const { data: inserted, error: insertError } = await adminClient
      .from('photos')
      .insert({
        id: photoId,
        tache_id: tacheId,
        organisation_id: session.organisation_id,  // toujours depuis session (D-4-016)
        uploader_id: session.user_id,
        storage_path: storagePath,
        commentaire: commentaire ?? null,
        mime_type: declaredMime as 'image/jpeg' | 'image/png' | 'image/webp',
        taille_octets: buf.length,
      })
      .select('id, tache_id, commentaire, created_at, uploader_id')
      .single()

    if (insertError || !inserted) {
      reqLogger.error(
        { err: insertError?.message, userId: session.user_id },
        'POST /api/photos : erreur INSERT — rollback Storage best-effort (RG-PHOTO-004)',
      )
      // Rollback Storage best-effort (RG-PHOTO-004, K4-MED-02)
      adminClient.storage.from('photos').remove([storagePath]).catch((removeErr: unknown) => {
        reqLogger.warn(
          { err: removeErr instanceof Error ? removeErr.message : String(removeErr) },
          'POST /api/photos : rollback Storage KO (best-effort accepte)',
        )
      })
      return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
    }

    // Etape 11 — Generer signed URL TTL 1h (D-4-004)
    const signedUrlMap = await signPhotoPaths([storagePath])
    const signedUrl = signedUrlMap.get(storagePath)

    if (!signedUrl) {
      reqLogger.warn(
        { userId: session.user_id, photoId },
        'POST /api/photos : signed URL non generee — 502',
      )
      return NextResponse.json(
        { error: 'Fichier enregistré mais URL non disponible. Réessayez.' },
        { status: 502 },
      )
    }

    // Reponse 201 — storage_path JAMAIS inclus (D-4-006, K4-MED-01)
    const responseBody: PhotoOuvrierDisplay = {
      id: inserted.id,
      commentaire: inserted.commentaire,
      created_at: inserted.created_at,
      uploader_id: inserted.uploader_id,
      signed_url: signedUrl,
      // storage_path INTENTIONNELLEMENT ABSENT (D-4-006 — jamais expose)
    }

    reqLogger.info({ userId: session.user_id, photoId }, 'Photo uploadee avec succes')

    return NextResponse.json(responseBody, { status: 201 })
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'POST /api/photos : erreur non geree',
    )
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
