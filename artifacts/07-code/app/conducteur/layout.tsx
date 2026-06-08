// app/conducteur/layout.tsx — Sprint 4 Visibilité
// Layout conducteur — mobile-first, max-width 390px
// MODIFIÉ Sprint 4 : ConducteurHeader partagé (chrome logo + NotificationBell + AvatarMenu)
//
// PO décision binding (HITL) : Option B fusion propre SANS store
// ConducteurHeader porte le chrome (logo/marque + NotificationBell + ConducteurAvatarMenu)
// Chaque page enfant conserve son titre contextuel dans son <main> (titre + retour + sous-titre)
//
// D-4V-013 : ouvrier hors scope — ConducteurHeader JAMAIS rendu dans layout ouvrier
// D-4V-012 : NotificationBell sur toutes les pages conducteur via ce layout

import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ConducteurHeader } from '@/components/ConducteurHeader'

export const metadata: Metadata = {
  title: {
    default: 'ClawBTP',
    template: '%s | ClawBTP',
  },
}

export default async function ConducteurLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Fetch initiales conducteur pour ConducteurHeader (pattern identique à chantiers/page.tsx)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let initiales = 'SC'
  if (user) {
    const adminClient = createAdminClient()
    const { data: profil } = await adminClient
      .from('users')
      .select('prenom, nom')
      .eq('id', user.id)
      .single()

    initiales = profil
      ? (`${(profil.prenom ?? '').charAt(0)}${(profil.nom ?? '').charAt(0)}`.toUpperCase() || 'SC')
      : (user.email ?? 'SC').substring(0, 2).toUpperCase()
  }

  return (
    <div className="mobile-interface">
      <div className="max-w-[390px] mx-auto min-h-screen bg-cream relative">
        {/* ConducteurHeader partagé — chrome présent sur TOUTES les pages conducteur */}
        {/* Remplace les portions chrome (logo + avatar) des <header> inline des pages enfants */}
        <ConducteurHeader initiales={initiales} />
        {children}
      </div>
    </div>
  )
}
