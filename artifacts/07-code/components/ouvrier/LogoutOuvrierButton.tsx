'use client'
// components/ouvrier/LogoutOuvrierButton.tsx — S4-F03 (D-4-008)
//
// Bouton déconnexion ouvrier — header coin droit
// Au clic : POST /api/ouvrier/logout -> si 200: window.location.href = '/ouvrier/scan' (hard redirect)
// Si erreur réseau : toast "Erreur de déconnexion. Réessayez."
//
// RG-LOGOUT-004 : le bouton est exempt sur /ouvrier/scan et /ouvrier/no-affectation
// Decision PO (A2) : filtrage usePathname() dans ce composant (option simple sans restructuration)
//
// Touch target : min 44×44px (spec maquette 04-logout-ouvrier-sprint-4.html)
// K4-MED-08 : côté serveur SameSite=Lax suffit

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { useToast } from '@/lib/hooks/use-toast'

// Pages exemptées du bouton logout (RG-LOGOUT-004)
const EXEMPT_PATHS = ['/ouvrier/scan', '/ouvrier/no-affectation']

export function LogoutOuvrierButton() {
  const pathname = usePathname()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)

  // RG-LOGOUT-004 (A2 — Decision PO) : ne pas afficher sur les pages exemptées
  if (EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return null
  }

  async function handleLogout() {
    if (isLoading) return
    setIsLoading(true)

    try {
      const response = await fetch('/api/ouvrier/logout', {
        method: 'POST',
        // Pas de body (K4-MED-09 : sessionId depuis cookie uniquement)
      })

      if (response.ok) {
        // RG-LOGOUT-004 : hard redirect pour forcer la mise à jour du cookie
        // Ne pas utiliser router.push (cookie non mis à jour immédiatement)
        window.location.href = '/ouvrier/scan'
        return
      }

      // Réponse non-ok (ne devrait pas arriver — le handler retourne toujours 200)
      toast({
        title: 'Erreur de déconnexion',
        description: 'Réessayez.',
        variant: 'destructive',
      })
    } catch {
      // Erreur réseau
      toast({
        title: 'Erreur de déconnexion',
        description: 'Réessayez.',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoading}
      data-testid="ouvrier-btn-logout"
      aria-label="Se déconnecter"
      style={{
        // Touch target ≥ 44×44px (spec maquette 04-logout-ouvrier-sprint-4.html)
        minWidth: '44px',
        minHeight: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        // Fond transparent, bordure blanche semi-transparente
        backgroundColor: 'transparent',
        border: '1.5px solid rgba(255,255,255,0.35)',
        borderRadius: '6px',
        padding: '6px 10px',
        cursor: isLoading ? 'not-allowed' : 'pointer',
        color: '#FAFAF8',
        fontFamily: '"Public Sans", sans-serif',
        fontWeight: 600,
        fontSize: '13px',
        flexShrink: 0,
        opacity: isLoading ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {isLoading ? (
        // Dot-pulse animation (design-system-sprint-3)
        <span
          style={{
            display: 'flex',
            gap: '3px',
            alignItems: 'center',
          }}
          aria-hidden="true"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                backgroundColor: '#FAFAF8',
                animation: `pulse 1.2s ${i * 0.2}s infinite ease-in-out`,
              }}
            />
          ))}
        </span>
      ) : (
        <>
          <LogOut size={16} aria-hidden="true" />
          <span>Sortir</span>
        </>
      )}
    </button>
  )
}
