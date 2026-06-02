// app/ouvrier/chantiers/[id]/page.tsx
// Page /ouvrier/chantiers/[id] — Vue chantier ouvrier
// Server Component — appel fetch vers GET /api/ouvrier/chantiers/[id]
// Render OuvrierChantierClient avec les donnees

import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { OuvrierChantierClient } from './client'
import type { GetChantierOuvrierResponse } from '@/types/database'

async function fetchChantier(
  chantierId: string,
  sessionCookieValue: string,
): Promise<GetChantierOuvrierResponse | null> {
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

    if (response.status === 401) return null   // session expiree
    if (response.status === 403) return null   // acces refuse (pas affecte)
    if (response.status === 404) return null   // chantier inexistant

    if (!response.ok) return null

    return response.json() as Promise<GetChantierOuvrierResponse>
  } catch {
    return null
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

  const chantierData = await fetchChantier(chantierId, sessionCookie.value)

  if (!chantierData) {
    // 401 : session expiree → redirect scan
    // 403/404 : chantier non accessible
    // On ne peut pas distinguer 401 vs 403/404 ici sans overhead
    // Le middleware gerera la session expirée au prochain hit
    notFound()
  }

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

      {/* Client Component pour les interactions (mutation statut) */}
      <OuvrierChantierClient
        chantierId={chantierId}
        initialData={chantierData}
      />
    </div>
  )
}
