// ============================================================
// /admin/equipe — Page Équipe admin
//
// Chantier 3 (Sprint UX-2) — Source : proto 18-admin-equipe.html
//
// Server Component — data fetching direct Supabase
// Passe la liste initiale à EquipeClient (Client Component)
//
// Auth : organisation_id extrait depuis app_metadata (JWT hook custom)
// RLS : la query est faite avec le client server (cookie session admin)
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { EquipeClient } from './EquipeClient'
import type { Tables } from '@/types/database'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Équipe — ClawBTP' }

type UserRow = Pick<
  Tables<'users'>,
  | 'id'
  | 'role'
  | 'nom'
  | 'prenom'
  | 'email'
  | 'telephone'
  | 'invitation_status'
  | 'has_supabase_auth'
  | 'created_at'
>

export default async function EquipePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Session expirée — le middleware redirige normalement vers /login,
  // mais on gère le cas edge par sécurité
  if (!user) {
    return (
      <div className="p-8">
        <p className="text-[#C00000] font-semibold">Session expirée. Reconnectez-vous.</p>
      </div>
    )
  }

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined

  if (!organisationId) {
    return (
      <div className="p-8">
        <p className="text-[#C00000] font-semibold">Organisation introuvable.</p>
      </div>
    )
  }

  // Récupérer les membres de l'organisation
  // qr_token exclu du SELECT (jamais exposé — S-01)
  const { data: usersRaw } = await supabase
    .from('users')
    .select(
      'id, role, nom, prenom, telephone, email, has_supabase_auth, invitation_status, created_at',
    )
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: true })

  const users = (usersRaw ?? []) as unknown as UserRow[]

  return <EquipeClient initialUsers={users} />
}
