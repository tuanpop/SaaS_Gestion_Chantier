'use client'
// components/chat/ClawWelcomeFetcher.tsx — Chargement accueil Claw + rendu bannière
//
// Implements: US-082 (accueil Claw ouvrier)
// Fetche GET /api/ouvrier/accueil-claw au montage
// D-8-16 BINDING : best-effort — si null → ne rien afficher (pas d'erreur visible)
// D-051 BINDING : la donnée venue de l'API ne contient jamais note_privee_conducteur
// EXI-8-06 BINDING : ClawWelcomeBanner rend en JSX pur (jamais dangerouslySetInnerHTML)
// data-testid="claw-welcome-fetcher"

import { useState, useEffect } from 'react'
import { ClawWelcomeBanner } from '@/components/chat/ClawWelcomeBanner'

interface AccueilData {
  contenu: string
  meteo_disponible: boolean
  llm_utilise: boolean
  date_accueil: string
}

export function ClawWelcomeFetcher() {
  const [accueil, setAccueil] = useState<AccueilData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const fetchAccueil = async () => {
      try {
        const res = await fetch('/api/ouvrier/accueil-claw', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) {
          setLoaded(true)
          return
        }
        const data = await res.json() as { accueil: AccueilData | null }
        setAccueil(data.accueil)
      } catch {
        // D-8-16 : best-effort silencieux
      } finally {
        setLoaded(true)
      }
    }
    void fetchAccueil()
  }, [])

  // Ne rien afficher tant que le chargement n'est pas terminé (évite le flash)
  if (!loaded || !accueil) return null

  return (
    <div data-testid="claw-welcome-fetcher">
      <ClawWelcomeBanner
        contenu={accueil.contenu}
        meteoDisponible={accueil.meteo_disponible}
        llmUtilise={accueil.llm_utilise}
      />
    </div>
  )
}

export default ClawWelcomeFetcher
