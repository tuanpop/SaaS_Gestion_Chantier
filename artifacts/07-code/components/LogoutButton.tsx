'use client'

// ============================================================
// LogoutButton — composant client pour déconnexion
//
// Chantier 2 (Sprint UX-2) — décision humaine : bouton simple
// POSTs vers /api/auth/logout → redirect /login
//
// Variantes :
//   - 'sidebar' : intégration barre de nav admin (fond sombre)
//   - 'menu'    : menu dropdown avatar conducteur (fond blanc)
//
// Sécurité :
//   - Pas d'exposition de token/clé (client-side fetch uniquement)
//   - 401 de l'API (session déjà expirée) → redirect /login quand même (cas normal)
//   - Erreur réseau → état d'erreur inline, pas de console.log
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

// ============================================================
// Props
// ============================================================

interface LogoutButtonProps {
  /** Contrôle le style d'affichage selon le contexte */
  variant?: 'sidebar' | 'menu'
}

// ============================================================
// Composant
// ============================================================

export function LogoutButton({ variant = 'sidebar' }: LogoutButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleLogout() {
    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })

      // 200 ou 401 (session déjà expirée) → redirect /login dans les deux cas
      if (res.ok || res.status === 401) {
        router.push('/login')
        return
      }

      // Autre erreur serveur — afficher un message inline (pas de console.log)
      setErrorMsg('Une erreur est survenue. Veuillez réessayer.')
    } catch {
      // Erreur réseau
      setErrorMsg('Impossible de se déconnecter. Vérifiez votre connexion.')
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // Variante sidebar (admin) — s'intègre dans la sidebar sombre
  // ============================================================

  if (variant === 'sidebar') {
    return (
      <div className="w-full">
        {errorMsg && (
          <p
            role="alert"
            className="px-6 py-1 text-xs text-[#C00000]"
          >
            {errorMsg}
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loading}
          aria-busy={loading}
          className="flex items-center gap-3 px-6 py-3 text-[15px] font-medium text-[#94A3B8] hover:text-[#C00000] hover:bg-[#1F0000]/20 w-full transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          {loading ? 'Déconnexion...' : 'Se déconnecter'}
        </button>
      </div>
    )
  }

  // ============================================================
  // Variante menu (conducteur) — compact, fond blanc
  // ============================================================

  return (
    <div>
      {errorMsg && (
        <p
          role="alert"
          className="text-xs text-[#C00000] px-2 py-1"
        >
          {errorMsg}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loading}
        aria-busy={loading}
        className="btn-brutal bg-white text-[#C00000] flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <LogOut className="w-4 h-4" aria-hidden="true" />
        {loading ? 'Déconnexion...' : 'Se déconnecter'}
      </button>
    </div>
  )
}

export default LogoutButton
