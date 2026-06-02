// app/ouvrier/chantiers/page.tsx
// Page /ouvrier/chantiers — Selecteur multi-affectations
// Server Component — appel fetch vers GET /api/ouvrier/me
//
// RG-MULTI-001 : si ≥2 affectations → afficher selecteur
// RG-MULTI-002 : si 1 seule affectation → redirect automatique vers le chantier
// D-011 : cookies() async obligatoire (Next.js 15)

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { ChantierSelectorCard } from '@/components/ouvrier/ChantierSelectorCard'

type AffectationEnrichie = {
  affectation_id: string
  chantier_id: string
  chantier_nom: string
  vue: string
}

type MeResponse = {
  user_id: string
  nom: string
  prenom: string
  organisation_id: string
  affectations: AffectationEnrichie[]
}

async function fetchMe(): Promise<MeResponse | null> {
  // D-011 : cookies() async Next.js 15
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('ouvrier_session')

  if (!sessionCookie) {
    return null
  }

  try {
    // Appel vers notre propre API (Server Component → Route Handler)
    const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/ouvrier/me`, {
      headers: {
        // Forwarder le cookie de session
        Cookie: `ouvrier_session=${sessionCookie.value}`,
      },
      cache: 'no-store', // K3-I-04
    })

    if (!response.ok) {
      return null
    }

    return response.json() as Promise<MeResponse>
  } catch {
    return null
  }
}

export default async function OuvrierChantiersPage() {
  const meData = await fetchMe()

  // Session invalide ou absente → le middleware gerera le redirect /ouvrier/scan
  if (!meData) {
    redirect('/ouvrier/scan')
  }

  const affectations = meData.affectations ?? []

  // RG-MULTI-002 : 1 seule affectation → redirect direct
  const firstAff = affectations[0]
  if (affectations.length === 1 && firstAff !== undefined) {
    redirect(`/ouvrier/chantiers/${firstAff.chantier_id}`)
  }

  // RG-MULTI-001 : ≥2 affectations ou 0 → afficher selecteur
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h1
        style={{
          fontFamily: 'Outfit, sans-serif',
          fontWeight: 700,
          fontSize: '22px',
          color: '#163958',
          marginBottom: '8px',
        }}
      >
        Bonjour {meData.prenom}
      </h1>

      {affectations.length === 0 ? (
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '15px',
            color: '#4A4A4A',
          }}
        >
          Aucun chantier actif pour le moment.
        </p>
      ) : (
        <>
          <p
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '15px',
              color: '#4A4A4A',
              marginBottom: '8px',
            }}
          >
            Selectionnez votre chantier :
          </p>

          <div
            data-testid="ouvrier-chantier-selector-list"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {affectations.map((aff) => (
              <ChantierSelectorCard
                key={aff.affectation_id}
                chantierId={aff.chantier_id}
                chantierNom={aff.chantier_nom}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
