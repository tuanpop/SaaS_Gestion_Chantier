// app/(conducteur)/chantiers/[id]/page.tsx
// Détail chantier conducteur — tâches + bouton affecter ouvrier
// Hybrid: Server Component pour le fetch initial, Client Components pour les interactions
//
// Proto référencé :
//   mockups/09-conducteur-chantier-detail.html (tabs Tâches / Équipe / Photos)
//   mockups/10-conducteur-taches.html (création tâche)
//
// Sections :
//   1. Header chantier (nom, client, dates, pastille)
//   2. Tabs : Tâches / Équipe
//   3. Liste des tâches avec TacheItem (conducteur peut modifier)
//   4. Bouton "Nouvelle tâche" -> /conducteur/chantiers/[id]/taches/nouvelle
//   5. Bouton "Affecter un ouvrier" -> AffectationForm

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calculerCouleur } from '@/lib/coloration'
import type { Chantier, TacheWithUser, AffectationWithUser } from '@/types/database'
import { ChantierDetailConducteurClient } from './client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const COULEUR_MAP = {
  rouge: { badge: 'badge badge-danger', label: 'En retard' },
  orange: { badge: 'badge badge-warning', label: 'Dérive' },
  vert: { badge: 'badge badge-success', label: 'OK' },
}

export default async function ChantierDetailConduPage({ params }: PageProps) {
  const { id: chantierId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return notFound()

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  if (!organisationId) return notFound()

  const adminClient = createAdminClient()

  // Récupérer le chantier
  const { data: chantierRaw, error } = await adminClient
    .from('chantiers')
    .select('*')
    .eq('id', chantierId)
    .eq('organisation_id', organisationId)
    .single()

  if (error || !chantierRaw) return notFound()

  const chantier = chantierRaw as unknown as Chantier
  const couleur = calculerCouleur(
    {
      date_fin_prevue: chantier.date_fin_prevue,
      budget_alloue: chantier.budget_alloue,
      budget_depense: chantier.budget_depense,
    },
    new Date(),
  )
  const couleurStyles = COULEUR_MAP[couleur]

  // Récupérer les tâches
  const { data: tachesRaw } = await adminClient
    .from('taches')
    .select(`
      id, chantier_id, organisation_id, titre, description,
      statut, assigned_to, date_echeance, bloque_raison, created_by, created_at, updated_at,
      assigned_user:users!taches_assigned_to_fkey (nom, prenom)
    `)
    .eq('chantier_id', chantierId)
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: true })

  const taches = (tachesRaw ?? []) as unknown as TacheWithUser[]

  // Récupérer les affectations avec infos utilisateur
  const { data: affectationsRaw } = await adminClient
    .from('affectations')
    .select(`
      id, user_id, chantier_id, organisation_id, vue, date_debut, date_fin, created_by, created_at,
      user:users!affectations_user_id_fkey (nom, prenom, role)
    `)
    .eq('chantier_id', chantierId)
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: true })

  const affectations = (affectationsRaw ?? []) as unknown as AffectationWithUser[]

  // Récupérer la liste des ouvriers et conducteurs de l'organisation pour l'AffectationForm
  const { data: membresRaw } = await adminClient
    .from('users')
    .select('id, nom, prenom, role')
    .eq('organisation_id', organisationId)
    .in('role', ['ouvrier', 'conducteur'])
    .order('prenom', { ascending: true })

  const membres = (membresRaw ?? []) as Array<{
    id: string
    nom: string
    prenom: string
    role: 'ouvrier' | 'conducteur'
  }>

  return (
    <>
      {/* Header */}
      <header className="bg-primary-dark px-4 py-4">
        <Link
          href="/conducteur/chantiers"
          className="text-white/70 text-xs flex items-center gap-1 mb-1"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Retour
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-white text-lg font-bold flex-1">
            {chantier.nom}
          </h1>
          <span className={`${couleurStyles.badge} shrink-0 text-xs`}>
            {couleurStyles.label}
          </span>
        </div>
        <p className="text-white/60 text-xs mt-1">{chantier.client_nom}</p>
      </header>

      {/* Client Component pour les interactions (tâches + affectation) */}
      <ChantierDetailConducteurClient
        chantier={chantier}
        chantierId={chantierId}
        taches={taches}
        affectations={affectations}
        membres={membres}
      />

      {/* Bottom Navigation conducteur */}
      <nav className="bottom-nav">
        <Link href="/conducteur/chantiers" className="active">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Chantiers</span>
        </Link>
        <Link href="/conducteur/taches">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <span>Tâches</span>
        </Link>
        <Link href="/conducteur/cr">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>CR</span>
        </Link>
        <Link href="/conducteur/alertes">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <span>Alertes</span>
        </Link>
        <Link href="/conducteur/chats">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>Chats</span>
        </Link>
      </nav>
    </>
  )
}
