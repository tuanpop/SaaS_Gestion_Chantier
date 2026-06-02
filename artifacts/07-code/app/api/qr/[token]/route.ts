// GET /api/qr/[token] - Backward compatibility redirect
//
// Sprint 3 / D-052/PO-3-04 : le handler QR scan ouvrier vit maintenant a
// /api/auth/qr/[token] (regroupement /api/auth/). Ce handler preserve la
// stabilite des URLs encodees dans les QR codes deja imprimes (decision PO :
// "les QR deja imprimes ne doivent JAMAIS se casser").
//
// 307 Temporary Redirect preserve la methode HTTP et n'est pas mis en cache
// agressivement par les navigateurs/CDN. Le browser suit le redirect
// automatiquement, le user arrive sur /api/auth/qr/[token] qui execute la
// vraie logique (dechiffrement token, creation session Redis, cookie, redirect
// vers vue chantier ou no-affectation).
//
// Cette route est listee dans middleware.ts PUBLIC_PREFIXES (/api/qr/) pour
// bypasser le check JWT - le token QR est le seul credential necessaire.

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params
  const target = new URL(`/api/auth/qr/${token}`, request.url)
  return NextResponse.redirect(target, { status: 307 })
}
