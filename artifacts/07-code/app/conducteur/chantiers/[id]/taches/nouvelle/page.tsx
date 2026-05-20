// app/(conducteur)/chantiers/[id]/taches/nouvelle/page.tsx
// Server Component — charge la liste des membres assignables et délègue le formulaire
// au Client Component (./client.tsx).
//
// Bug 3 (fix dette Sprint 2 — 2026-05-20) : ajout du champ assigned_to.
// La liste = ouvriers + conducteurs de l'organisation (cohérent avec AffectationForm).
// Sécurité : on filtre par organisation_id depuis le JWT (T-01) — ne JAMAIS faire
// confiance au paramètre [id] ; le chantier peut être hors org si le conducteur
// triche l'URL, mais le POST /api/chantiers/[id]/taches re-vérifie l'accès.

import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NouvelleTacheClient, type AssignableMember } from './client'

export const dynamic = 'force-dynamic'

export default async function NouvelleTachePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const adminClient = createAdminClient()

  const { data: membresRaw } = await adminClient
    .from('users')
    .select('id, nom, prenom, role')
    .eq('organisation_id', organisationId)
    .in('role', ['ouvrier', 'conducteur'])
    .is('deleted_at', null)
    .order('prenom', { ascending: true })

  const membres = (membresRaw ?? []) as AssignableMember[]

  return <NouvelleTacheClient membres={membres} />
}
