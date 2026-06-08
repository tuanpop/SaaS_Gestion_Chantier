// app/conducteur/chantiers/page.tsx
// Liste chantiers conducteur — ses chantiers uniquement (filtrés côté API via Q1)
// Server Component — data fetching direct
//
// Proto référencé : mockups/08-conducteur-chantiers.html
// Design system Hana : mobile-first, max-width 390px, bottom-nav, card-brutal mobile
// Q1 : conducteur voit uniquement ses chantiers (créateur OU affecté)
//
// SPRINT 4 — Chrome (logo + avatar) retiré de cette page.
// ConducteurHeader dans app/conducteur/layout.tsx porte désormais le chrome partagé.
// Ce fichier ne rend plus que le contenu contextuel (titre + liste chantiers + bottom-nav).

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculerCouleur, trierParCouleur } from '@/lib/coloration'
import { ChantierCard } from '@/components/ChantierCard'
import type { Chantier, ChantierWithColoration } from '@/types/database'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mes chantiers' }

export default async function ChantiersConduPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="px-4 pt-6">
        <p className="text-danger font-semibold">Session expirée.</p>
      </div>
    )
  }

  const organisationId = user.app_metadata?.['organisation_id'] as string | undefined
  const userId = user.id

  if (!organisationId) {
    return (
      <div className="px-4 pt-6">
        <p className="text-danger font-semibold">Organisation introuvable.</p>
      </div>
    )
  }

  const adminClient = createAdminClient()

  // SPRINT 4 : initiales supprimées ici — ConducteurHeader du layout les fournit désormais.
  // Récupérer les IDs des chantiers auxquels le conducteur est affecté
  const { data: affectationsRaw } = await adminClient
    .from('affectations')
    .select('chantier_id')
    .eq('user_id', userId)
    .eq('organisation_id', organisationId)

  type AffRow = { chantier_id: string }
  const affectedIds = ((affectationsRaw ?? []) as unknown as AffRow[]).map((a) => a.chantier_id)

  // Requête : chantiers créés par le conducteur OU affectés
  let query = adminClient
    .from('chantiers')
    .select('*')
    .eq('organisation_id', organisationId)
    .eq('statut', 'actif')

  if (affectedIds.length > 0) {
    query = query.or(`created_by.eq.${userId},id.in.(${affectedIds.join(',')})`)
  } else {
    query = query.eq('created_by', userId)
  }

  const { data: chantiersRaw } = await query.order('date_fin_prevue', { ascending: true })
  const chantiers = (chantiersRaw ?? []) as unknown as Chantier[]

  const aujourdhui = new Date()
  const chantiersColores: ChantierWithColoration[] = chantiers.map((c) => ({
    ...c,
    couleur: calculerCouleur(
      {
        date_fin_prevue: c.date_fin_prevue,
        budget_alloue: c.budget_alloue,
        budget_depense: c.budget_depense,
      },
      aujourdhui,
    ),
  }))

  const chantiersTriés = trierParCouleur(chantiersColores)

  return (
    <>
      {/* Contenu — ConducteurHeader du layout porte le chrome (logo + NotificationBell + avatar) */}
      <main className="px-4 pt-4 pb-40 flex flex-col gap-3">
        {/* Titre contextuel (reste dans <main>, non dans le header partagé) */}
        <h1 className="font-heading font-bold text-xl text-primary-dark px-0 pb-2 pt-1">
          Mes chantiers
        </h1>
        {chantiersTriés.length === 0 && (
          <div className="card-brutal-mobile p-8 text-center mt-4">
            <svg className="w-12 h-12 text-muted mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <p className="font-heading font-bold text-lg mb-1">Aucun chantier</p>
            <p className="text-sm text-muted">Aucun chantier ne vous est assigné pour le moment.</p>
          </div>
        )}

        {chantiersTriés.map((chantier) => (
          <ChantierCard
            key={chantier.id}
            chantier={chantier}
            href={`/conducteur/chantiers/${chantier.id}`}
            variant="mobile"
          />
        ))}
      </main>

      {/* Bottom Navigation — 5 onglets conducteur (proto 08) */}
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
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
          <span>CR</span>
        </Link>
        <Link href="/conducteur/alertes" className="relative">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <span>Alertes</span>
        </Link>
        <Link href="/conducteur/chats" className="relative">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>Chats</span>
          <span className="absolute -top-1 right-0 w-4 h-4 bg-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center">7</span>
        </Link>
      </nav>
    </>
  )
}
