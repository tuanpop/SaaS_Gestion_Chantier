// app/(admin)/chantiers/[id]/page.tsx
// Détail chantier admin — infos, tâches, affectations
// Server Component — data fetching via adminClient
//
// Proto référencé :
//   mockups/16-admin-chantier-detail.html (tabs Informations / Tâches / Photos / CR)
//   mockups/15-admin-dashboard.html (structure sidebar)
//
// Sections :
//   1. Header : nom, client, pastille couleur, badge statut, dates, budget
//   2. Actions admin : bouton "Archiver" (confirmation)
//   3. Liste des tâches : TacheItem (lecture seule pour admin)
//   4. Liste des affectations actives

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calculerCouleur } from '@/lib/coloration'
import { ArchiveButton } from './archive-button'
import { ChantierDetailAdminTabs } from './tabs-client'
import type { Chantier, TacheWithUser, AffectationWithUser } from '@/types/database'
// T04 — TacheItem supprimé de cet import (remplacé par tableau inline dans tabs-client.tsx)
// T04 — ChantierDetailAdminTabs extrait en Client Component pour gérer l'état des tabs

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

// ============================================================
// Helpers
// ============================================================

// T04 — COULEUR_MAP reste ici pour le header (badge statut)
// formatDate et formatMontant ont migré dans tabs-client.tsx avec le contenu tabulé
const COULEUR_MAP = {
  rouge: { border: 'border-l-danger', badge: 'badge badge-danger', label: 'En retard' },
  orange: { border: 'border-l-warning', badge: 'badge badge-warning', label: 'Dérive' },
  vert: { border: 'border-l-success', badge: 'badge badge-success', label: 'OK' },
}

// ============================================================
// Page
// ============================================================

export default async function ChantierDetailAdminPage({ params }: PageProps) {
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

  // Récupérer les affectations
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
  // T04 — budgetProgress et isEstDepasse supprimés ici (calcul migré dans tabs-client.tsx)

  // Bug 2 fix (Sprint 2 dette) — liste membres assignables pour AffectationForm côté admin
  // Cohérent avec le fetch dans /conducteur/chantiers/[id]/page.tsx
  const { data: membresRaw } = await adminClient
    .from('users')
    .select('id, nom, prenom, role')
    .eq('organisation_id', organisationId)
    .in('role', ['ouvrier', 'conducteur'])
    .is('deleted_at', null)
    .order('prenom', { ascending: true })

  const membres = (membresRaw ?? []) as Array<{
    id: string
    nom: string
    prenom: string
    role: 'ouvrier' | 'conducteur'
  }>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/admin/chantiers"
            className="text-xs text-muted flex items-center gap-1 mb-2 hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Retour aux chantiers
          </Link>
          <div className="flex items-center gap-4">
            <h1 className="font-heading font-bold text-[28px]">{chantier.nom}</h1>
            <span className={`${couleurStyles.badge} text-sm`}>{couleurStyles.label}</span>
            {chantier.statut === 'archive' && (
              <span className="badge badge-muted text-sm">Archivé</span>
            )}
          </div>
          <p className="text-muted mt-1">Client : {chantier.client_nom}</p>
        </div>
        {/* Actions admin */}
        {chantier.statut === 'actif' && (
          <div className="flex gap-3">
            <Link
              href={`/admin/chantiers/${chantierId}/modifier`}
              className="btn-brutal bg-white text-primary text-sm py-2 px-4"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Modifier
            </Link>
            <ArchiveButton chantierId={chantierId} />
          </div>
        )}
      </div>

      {/* T04 — Système de tabs : Client Component gère les tabs et tout le contenu tabulé */}
      {/* Informations (grille infos + budget + affectations) et Tâches sont dans ChantierDetailAdminTabs */}
      <ChantierDetailAdminTabs
        chantier={chantier}
        chantierId={chantierId}
        taches={taches}
        affectations={affectations}
        membres={membres}
        couleurStyles={couleurStyles}
      />
    </div>
  )
}

