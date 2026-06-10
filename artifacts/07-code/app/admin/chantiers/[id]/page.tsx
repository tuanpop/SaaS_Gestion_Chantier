// app/(admin)/chantiers/[id]/page.tsx
// Détail chantier admin — infos, tâches, affectations, photos
// Server Component — data fetching via adminClient
//
// Proto référencé :
//   mockups/16-admin-chantier-detail.html (tabs Informations / Tâches / Photos / CR)
//   mockups/15-admin-dashboard.html (structure sidebar)
//
// Sections :
//   1. Header : nom, client, pastille couleur, badge statut, dates, budget
//   2. Actions admin : bouton "Archiver" (confirmation)
//   3. Liste des tâches avec note_privee_conducteur (SELECT mis à jour — fix #6)
//   4. Liste des affectations actives
//   5. Photos — fix #5 : fetch server-side + signPhotoPaths (mirror pattern D-4-019 conducteur)
//
// Sécurité fix #5 :
//   K4-CR-02 : SELECT photos filtre organisation_id = org du JWT (isolation org server-side)
//   D-4-019 : pas d'endpoint REST GET photos admin — server-side direct
//   D-4-006 : storage_path JAMAIS transmis au client
//   K4-HI-06 : referrerpolicy="no-referrer" sur <img> signed_url côté client
//   K4-NPR-01 : note_privee_conducteur JAMAIS dans payload ouvrier (non-régression préservée)

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Pencil } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calculerCouleur } from '@/lib/coloration'
import { signPhotoPaths } from '@/lib/photos-access'
import { ArchiveButton } from './archive-button'
import { UnarchiveButton } from './unarchive-button'
import { ChantierDetailAdminTabs } from './tabs-client'
import type { Chantier, TacheWithUser, AffectationWithUser, PhotoConducteurDisplay } from '@/types/database'
import type { CompteRenduListe, RapportHebdoListe } from '@/types/reporting'
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

  // Récupérer les tâches — fix #6 : SELECT inclut note_privee_conducteur (admin autorisé à voir/éditer)
  // K4-NPR-01 : ce SELECT est admin-only (adminClient + filtres org) — jamais exposé ouvrier
  const { data: tachesRaw } = await adminClient
    .from('taches')
    .select(`
      id, chantier_id, organisation_id, titre, description,
      statut, assigned_to, date_echeance, bloque_raison, note_privee_conducteur,
      created_by, created_at, updated_at,
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

  // Sprint 5 — CRs journaliers (liste compacte — sans contenu_genere/donnees_brutes)
  // Note: comptes_rendus/rapports_hebdo pas encore dans Database types (dette post-migration)
  // Pattern Zoro Bug A : (adminClient as unknown as any).from('table') — identique notifications
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: crsRaw } = await (adminClient as unknown as any)
    .from('comptes_rendus')
    .select('id, chantier_id, organisation_id, date_cr, statut, declenche_par, valide_par, valide_at, envoye_at, created_at, updated_at')
    .eq('chantier_id', chantierId)
    .eq('organisation_id', organisationId)
    .order('date_cr', { ascending: false })
    .limit(20)

  const crs = (crsRaw ?? []) as unknown as CompteRenduListe[]

  // Sprint 5 — Rapports hebdo (liste compacte — sans contenu_genere)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rapportsHebdoRaw } = await (adminClient as unknown as any)
    .from('rapports_hebdo')
    .select('id, chantier_id, organisation_id, annee_iso, semaine_iso, cr_ids, statut, valide_par, valide_at, envoye_at, created_at, updated_at')
    .eq('chantier_id', chantierId)
    .eq('organisation_id', organisationId)
    .order('annee_iso', { ascending: false })
    .order('semaine_iso', { ascending: false })
    .limit(10)

  const rapportsHebdo = (rapportsHebdoRaw ?? []) as unknown as RapportHebdoListe[]

  // Fix #5 — Photos fetch server-side (mirror pattern D-4-019 conducteur)
  // K4-CR-02 : SELECT photos filtre organisation_id = org du JWT (isolation org BINDING)
  // D-4-006 : storage_path lu internalement pour signPhotoPaths, JAMAIS transmis au client
  const tacheIds = taches.map((t) => t.id)
  let photosAdmin: PhotoConducteurDisplay[] = []

  if (tacheIds.length > 0) {
    const { data: photosRaw, error: photosError } = await adminClient
      .from('photos')
      .select('id, tache_id, storage_path, commentaire, uploader_id, created_at')
      .in('tache_id', tacheIds)
      .eq('organisation_id', organisationId) // K4-CR-02 : isolation org
      .order('created_at', { ascending: false })

    if (!photosError && photosRaw && photosRaw.length > 0) {
      const storagePaths = [...new Set(photosRaw.map((p) => p.storage_path))]
      const signedUrlMap = await signPhotoPaths(storagePaths)

      // Mapper vers PhotoConducteurDisplay — storage_path JAMAIS transmis au client (D-4-006)
      photosAdmin = photosRaw.map((p) => ({
        id: p.id,
        tache_id: p.tache_id,
        commentaire: p.commentaire,
        created_at: p.created_at,
        uploader_id: p.uploader_id,
        signed_url: signedUrlMap.get(p.storage_path) ?? '',
      }))
    }
    // Erreur fetch photos — non-bloquant, la page s'affiche sans photos (best-effort)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/admin/chantiers"
            className="text-xs text-muted flex items-center gap-1 mb-2 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
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
              <Pencil className="w-4 h-4" />
              Modifier
            </Link>
            <ArchiveButton chantierId={chantierId} />
          </div>
        )}

        {/* Sprint 2 dette — chantier archivé : seul bouton "Désarchiver" disponible */}
        {chantier.statut === 'archive' && (
          <div className="flex gap-3">
            <UnarchiveButton chantierId={chantierId} />
          </div>
        )}
      </div>

      {/* Bandeau info chantier archivé */}
      {chantier.statut === 'archive' && (
        <div className="card-brutal p-4 border-l-4 border-l-[#999] bg-[#F2F2F2] mb-6">
          <p className="text-sm">
            <strong>Chantier archivé</strong>
            {chantier.date_fin_reelle && (
              <> le {chantier.date_fin_reelle.split('-').reverse().join('/')}</>
            )}
            . Les données restent consultables. Cliquez sur « Désarchiver » pour le réactiver.
          </p>
        </div>
      )}

      {/* T04 — Système de tabs : Client Component gère les tabs et tout le contenu tabulé */}
      {/* Fix #5 : photos passées au client (PhotoConducteurDisplay[] — sans storage_path) */}
      <ChantierDetailAdminTabs
        chantier={chantier}
        chantierId={chantierId}
        taches={taches}
        affectations={affectations}
        membres={membres}
        couleurStyles={couleurStyles}
        photos={photosAdmin}
        crs={crs}
        rapportsHebdo={rapportsHebdo}
      />
    </div>
  )
}

