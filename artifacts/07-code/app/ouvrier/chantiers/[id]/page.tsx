// app/ouvrier/chantiers/[id]/page.tsx
// Page /ouvrier/chantiers/[id] — Vue chantier ouvrier
// Server Component — appel fetch vers GET /api/ouvrier/chantiers/[id]
// Render OuvrierChantierClient avec les donnees

import { redirect, notFound } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { OuvrierChantierClient } from './client'
import { getOuvrierSession } from '@/lib/ouvrier-session'
import type { GetChantierOuvrierResponse } from '@/types/database'

type FetchResult =
  | { kind: 'ok'; data: GetChantierOuvrierResponse }
  | { kind: 'unauthenticated' } // 401 — session expiree, perdue ou invalidee D-3-011
  | { kind: 'forbidden' }       // 403 — plus d'affectation active sur ce chantier
  | { kind: 'not_found' }       // 404 — chantier inexistant ou hors org
  | { kind: 'error' }           // autre

async function fetchChantier(
  chantierId: string,
  sessionCookieValue: string,
): Promise<FetchResult> {
  try {
    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'
    const response = await fetch(
      `${baseUrl}/api/ouvrier/chantiers/${chantierId}`,
      {
        headers: {
          Cookie: `ouvrier_session=${sessionCookieValue}`,
        },
        cache: 'no-store', // K3-I-04
      },
    )

    if (response.status === 401) return { kind: 'unauthenticated' }
    if (response.status === 403) return { kind: 'forbidden' }
    if (response.status === 404) return { kind: 'not_found' }
    if (!response.ok) return { kind: 'error' }

    const data = (await response.json()) as GetChantierOuvrierResponse
    return { kind: 'ok', data }
  } catch {
    return { kind: 'error' }
  }
}

export default async function OuvrierChantierPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: chantierId } = await params

  // D-011 : cookies() async Next.js 15
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('ouvrier_session')

  if (!sessionCookie) {
    redirect('/ouvrier/scan')
  }

  // Sprint 4 — extraire ouvrierUserId pour GalerieModale (point d'attention 6 du plan)
  // getOuvrierSession necessie un NextRequest — on le construit depuis les headers courants
  let ouvrierUserId: string | null = null
  try {
    const reqHeaders = await headers()
    // Construire un NextRequest minimal avec le cookie pour getOuvrierSession
    const fakeUrl = 'http://localhost'
    const fakeReq = new NextRequest(fakeUrl, {
      headers: {
        cookie: `ouvrier_session=${sessionCookie.value}`,
        ...Object.fromEntries(reqHeaders.entries()),
      },
    })
    const session = await getOuvrierSession(fakeReq)
    ouvrierUserId = session?.user_id ?? null
  } catch {
    // Best-effort : si getOuvrierSession echoue ici, le handler /api/ouvrier/chantiers/[id]
    // revalidera la session de toute facon. ouvrierUserId sera null -> is_mine UX desactive.
  }

  const result = await fetchChantier(chantierId, sessionCookie.value)

  // Distinguer les cas (smoke C5 2026-06-03) : le middleware Edge ne valide que la
  // presence du cookie (D-3-001), pas la session Postgres. Si la session est invalide
  // (expiree OU invalidee par D-3-011 sur DELETE affectation), le handler retourne 401.
  // Si l'ouvrier n'a plus d'affectation active sur ce chantier, le handler retourne 403.
  // Cas 404 = chantier inexistant ou hors org = on garde notFound().
  if (result.kind === 'unauthenticated') {
    redirect('/ouvrier/scan')
  }
  if (result.kind === 'forbidden') {
    redirect('/ouvrier/no-affectation')
  }
  if (result.kind !== 'ok') {
    notFound()
  }
  const chantierData = result.data

  return (
    <div>
      {/* Header chantier */}
      <div style={{ marginBottom: '24px' }}>
        <h1
          data-testid="ouvrier-chantier-header-nom"
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '22px',
            color: '#163958',
            marginBottom: '4px',
          }}
        >
          {chantierData.chantier.nom}
        </h1>
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '14px',
            color: '#666666',
          }}
        >
          {chantierData.chantier.adresse}, {chantierData.chantier.code_postal}
        </p>
      </div>

      {/* Client Component pour les interactions (mutation statut + photos Sprint 4) */}
      <OuvrierChantierClient
        chantierId={chantierId}
        initialData={chantierData}
        ouvrierUserId={ouvrierUserId ?? ''}
      />
    </div>
  )
}
