import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptQR } from '@/lib/crypto'
import { toApiResponse, ForbiddenError, NotFoundError } from '@/lib/errors'
import { createRequestLogger } from '@/lib/logger'
import type { UserRole, Tables } from '@/types/database'

// ============================================================
// GET /api/users/[id]/qr — QR code PNG ouvrier (admin uniquement)
//
// Retourne un PNG brut (buffer) avec Content-Type: image/png
// URL encodée dans le QR : ${NEXT_PUBLIC_APP_URL}/api/qr/${qr_token}
// T-01 : ownership check par organisation_id depuis JWT
// S-01 : token AES-256-GCM côté serveur uniquement
// E-03 : vérification que le user est bien un 'ouvrier' (conducteur = pas de QR)
// ============================================================

const IdParamSchema = z.string().uuid('Le paramètre id doit être un UUID valide.')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // await headers() OBLIGATOIRE — Next.js 15 (D-011)
  const headerStore = await headers()
  const correlationId = headerStore.get('x-correlation-id') ?? crypto.randomUUID()
  const reqLogger = createRequestLogger(correlationId)

  void request

  try {
    // 1. Extraire claims depuis headers middleware (T-01)
    const organisationId = headerStore.get('x-organisation-id')
    const role = headerStore.get('x-user-role') as UserRole | null

    if (!organisationId || !role) {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 2. Vérification rôle admin (E-03)
    if (role !== 'admin') {
      reqLogger.warn({ role, correlationId }, 'Non-admin tried to access GET /api/users/[id]/qr')
      throw new ForbiddenError()
    }

    // 3. Valider le paramètre [id]
    const resolvedParams = await params
    const idParsed = IdParamSchema.safeParse(resolvedParams.id)
    if (!idParsed.success) {
      return NextResponse.json(
        { error: 'Identifiant invalide.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    const userId = idParsed.data

    // 4. Requête DB avec ownership check (T-01)
    // On sélectionne qr_token ici car nécessaire pour générer le QR (usage interne uniquement)
    const supabase = await createClient()
    // Cast explicite : createServerClient résout Schema différemment de createClient,
    // ce qui donne 'never' sans annotation. Tables<'users'> est le type correct.
    const { data: userRecord, error: dbError } = await supabase
      .from('users')
      .select('id, organisation_id, role, nom, prenom, qr_token')
      .eq('id', userId)
      .eq('organisation_id', organisationId)
      .single() as { data: Pick<Tables<'users'>, 'id' | 'organisation_id' | 'role' | 'nom' | 'prenom' | 'qr_token'> | null; error: { message: string } | null }

    if (dbError || !userRecord) {
      reqLogger.warn(
        { userId, organisationId, error: dbError?.message, correlationId },
        'QR: user not found or not in organisation',
      )
      throw new NotFoundError('user')
    }

    // 5. Vérifier que le user est un ouvrier (E-03 — conducteur n'a pas de QR)
    if (userRecord.role !== 'ouvrier') {
      reqLogger.warn(
        { userId, userRole: userRecord.role, correlationId },
        'QR: requested for non-ouvrier user',
      )
      return NextResponse.json(
        { error: 'Les QR codes sont disponibles uniquement pour les ouvriers.' },
        { status: 400, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    // 6. Si qr_token null : régénérer et persister (cas migration)
    let qrToken = userRecord.qr_token

    if (!qrToken) {
      reqLogger.info(
        { userId, organisationId, correlationId },
        'QR: token null — regenerating',
      )

      qrToken = encryptQR({ user_id: userId, organisation_id: organisationId })

      // adminClient pour UPDATE car l'ouvrier n'a pas de session JWT
      // DANGER: bypass RLS intentionnel — mise à jour qr_token ouvrier
      const adminClient = createAdminClient()
      const { error: updateError } = await adminClient
        .from('users')
        .update({ qr_token: qrToken })
        .eq('id', userId)
        .eq('organisation_id', organisationId)

      if (updateError) {
        reqLogger.error(
          { error: updateError.message, userId, correlationId },
          'QR: failed to persist regenerated qr_token',
        )
        return NextResponse.json(
          { error: 'Une erreur interne est survenue.' },
          { status: 500, headers: { 'X-Correlation-Id': correlationId } },
        )
      }
    }

    // 7. Générer le PNG QR via la bibliothèque qrcode
    // URL encodée dans le QR : ${NEXT_PUBLIC_APP_URL}/api/auth/qr/${qr_token}
    // Sprint 3 (D-052/PO-3-04) : nouveau path /api/auth/qr/. Backward compat assuree
    // par un redirect handler 307 a /api/qr/[token] (preservation QR deja imprimes).
    const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'
    const qrUrl = `${appUrl}/api/auth/qr/${qrToken}`

    let pngBuffer: Buffer
    try {
      // QRCode.toBuffer retourne un Buffer PNG directement
      pngBuffer = await QRCode.toBuffer(qrUrl, {
        type: 'png',
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
    } catch (qrError) {
      reqLogger.error(
        { error: qrError instanceof Error ? qrError.message : String(qrError), correlationId },
        'QR: failed to generate PNG',
      )
      return NextResponse.json(
        { error: 'Une erreur interne est survenue.' },
        { status: 500, headers: { 'X-Correlation-Id': correlationId } },
      )
    }

    reqLogger.info(
      { userId, organisationId, correlationId },
      'QR code PNG generated successfully',
    )

    // 8. Retourner le buffer PNG brut (PAS base64 — plan.md §Points d'implémentation critiques)
    // Content-Type: image/png — consommable directement via <img src="/api/users/[id]/qr">
    // Uint8Array wrapping évite l'incompatibilité Buffer/BodyInit dans Next.js (tsconfig strict)
    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(pngBuffer.length),
        'Cache-Control': 'private, no-store',
        'X-Correlation-Id': correlationId,
      },
    })
  } catch (error) {
    reqLogger.error(
      { error: error instanceof Error ? error.message : String(error), correlationId },
      'Unhandled error in GET /api/users/[id]/qr',
    )
    return toApiResponse(error, correlationId)
  }
}
