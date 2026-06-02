'use client'

// components/LogoutButton.tsx — migré Button shadcn (étape 7)
//
// Variantes :
//   - 'sidebar' : sidebar admin (fond sombre, ghost)
//   - 'menu'    : dropdown conducteur (fond blanc, destructive)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LogoutButtonProps {
  variant?: 'sidebar' | 'menu'
}

export function LogoutButton({ variant = 'sidebar' }: LogoutButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleLogout() {
    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })

      if (res.ok || res.status === 401) {
        router.push('/login')
        return
      }

      setErrorMsg('Une erreur est survenue. Veuillez réessayer.')
    } catch {
      setErrorMsg('Impossible de se déconnecter. Vérifiez votre connexion.')
    } finally {
      setLoading(false)
    }
  }

  // Variante sidebar — ghost blanc pour fond sombre
  if (variant === 'sidebar') {
    return (
      <div className="w-full">
        {errorMsg && (
          <p role="alert" className="px-6 py-1 text-xs text-[#C00000]">
            {errorMsg}
          </p>
        )}
        <Button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loading}
          aria-busy={loading}
          variant="ghost"
          className="w-full flex items-center gap-3 px-6 py-3 text-[15px] text-[#94A3B8] hover:text-[#C00000] hover:bg-[#1F0000]/20 justify-start border-transparent"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          {loading ? 'Déconnexion...' : 'Se déconnecter'}
        </Button>
      </div>
    )
  }

  // Variante menu — compact, fond blanc, rouge
  return (
    <div>
      {errorMsg && (
        <p role="alert" className="text-xs text-[#C00000] px-2 py-1">
          {errorMsg}
        </p>
      )}
      <Button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loading}
        aria-busy={loading}
        variant="destructive"
        size="sm"
        className="flex items-center gap-2"
      >
        <LogOut className="w-4 h-4" aria-hidden="true" />
        {loading ? 'Déconnexion...' : 'Se déconnecter'}
      </Button>
    </div>
  )
}

export default LogoutButton
