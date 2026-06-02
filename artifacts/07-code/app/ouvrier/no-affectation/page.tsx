'use client'
// app/ouvrier/no-affectation/page.tsx
// Page /ouvrier/no-affectation — Pas d'affectation active, afficher le contact conducteur
//
// Public — pas de session requise (OUVRIER_PUBLIC_ROUTES dans middleware.ts)
// D-3-006 : param `data` = JSON base64url encode par le handler QR
// K3-MED-10 : validation Zod cote client (fallback si parse echoue)
// K3-HI-11 BINDING : avertissement antiphishing obligatoire sous le bouton tel:
// HNA-K3-03 / F008 : texte exact valide par design-system-sprint-3.md (patch F003)

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AppelConducteurButton } from '@/components/ouvrier/AppelConducteurButton'
import { NoAffectationDataSchema } from '@/lib/validation/ouvrier'
import type { NoAffectationData } from '@/lib/validation/ouvrier'

// ============================================================
// Fallback si decode echoue (K3-MED-10)
// ============================================================
const FALLBACK_DATA: NoAffectationData = {
  conducteur_nom: 'Votre responsable',
  conducteur_prenom: '',
  conducteur_telephone: null,
  dernier_chantier_nom: 'votre chantier',
}

function parseDataParam(dataParam: string | null): NoAffectationData {
  if (!dataParam) return FALLBACK_DATA

  try {
    // Decode base64url → JSON (D-3-006)
    const jsonStr = atob(dataParam.replace(/-/g, '+').replace(/_/g, '/'))
    const raw: unknown = JSON.parse(jsonStr)
    const result = NoAffectationDataSchema.safeParse(raw)

    if (!result.success) {
      // Schema invalide → fallback (K3-MED-10)
      return FALLBACK_DATA
    }

    return result.data
  } catch {
    // atob echoue ou JSON.parse echoue → fallback (K3-MED-10)
    return FALLBACK_DATA
  }
}

function NoAffectationContent() {
  const searchParams = useSearchParams()
  const dataParam = searchParams.get('data')
  const data = parseDataParam(dataParam)

  const conducteurNomComplet = [data.conducteur_prenom, data.conducteur_nom]
    .filter(Boolean)
    .join(' ')
    || 'Votre responsable'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingTop: '24px' }}>
      {/* Titre */}
      <div>
        <h1
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '22px',
            color: '#163958',
            marginBottom: '8px',
          }}
        >
          Aucune affectation active
        </h1>
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '15px',
            color: '#4A4A4A',
            lineHeight: '1.5',
          }}
        >
          Vous n&apos;etes pas actuellement affecte a un chantier actif.
          {data.dernier_chantier_nom !== 'votre chantier' && (
            <> Le dernier chantier connu est : <strong>{data.dernier_chantier_nom}</strong>.</>
          )}
        </p>
      </div>

      {/* Contact conducteur */}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: '2px solid #163958',
          borderRadius: '4px',
          padding: '20px',
          boxShadow: '3px 3px 0 0 #163958',
        }}
      >
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '13px',
            color: '#888888',
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Votre responsable
        </p>
        <p
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '18px',
            color: '#163958',
            marginBottom: '16px',
          }}
        >
          {conducteurNomComplet}
        </p>

        {/* Bouton appel tel: — RG-NO-AFFECTATION-003 */}
        <AppelConducteurButton telephone={data.conducteur_telephone} />

        {/* Avertissement antiphishing OBLIGATOIRE (K3-HI-11 BINDING) */}
        {/* HNA-K3-03 / F008 : texte exact valide design-system patch F003 */}
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '12px',
            color: '#666666',
            marginTop: '12px',
            padding: '8px',
            backgroundColor: '#FFF8E1',
            border: '1px solid #F59E0B',
            borderRadius: '4px',
          }}
        >
          Verifiez ce numero avec votre responsable en cas de doute.
        </p>
      </div>

      {/* Message aide alternatif */}
      <Alert style={{ border: '1px solid #163958', borderRadius: '4px' }}>
        <AlertDescription
          style={{ fontFamily: '"Public Sans", sans-serif', fontSize: '14px' }}
        >
          Si le probleme persiste, contactez votre responsable directement pour
          qu&apos;il verifie votre affectation dans l&apos;application.
        </AlertDescription>
      </Alert>
    </div>
  )
}

export default function NoAffectationPage() {
  return (
    <Suspense fallback={
      <div style={{ textAlign: 'center', paddingTop: '32px', fontFamily: '"Public Sans", sans-serif' }}>
        Chargement...
      </div>
    }>
      <NoAffectationContent />
    </Suspense>
  )
}
