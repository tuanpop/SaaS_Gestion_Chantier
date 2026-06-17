// app/conducteur/chantiers/[id]/page.tsx
// Détail chantier conducteur — tâches + note privée + téléphone + photos modération (S4-F02, F005)
// Hybrid: Server Component pour le fetch initial, Client Components pour les interactions
//
// Sprint 4 changements :
//   S4-F02 : note_privee_conducteur ajoutée au SELECT taches (D-4-010)
//             telephone ajouté au join users des affectations (RG-TEL-001)
//   F005/D-4-019 : photos fetchées server-side + signPhotoPaths -> PhotoConducteurDisplay[]
//   SPRINT 4 — Chrome (logo + avatar) retiré de cette page.
//   ConducteurHeader dans app/conducteur/layout.tsx porte désormais le chrome partagé.
//   Le bloc contextuel (retour + nom chantier + badge + client_nom) reste ici en titre.
//
// Securite :
//   K4-CR-02 : SELECT photos filtre organisation_id = org du JWT (isolation org server-side)
//   K4-MED-13 : telephone cross-org bloque par RLS org JWT
//   K4-NPR-01 : note_privee_conducteur JAMAIS dans payload ouvrier (non-regression)
//   D-4-019 : pas d'endpoint REST GET photos conducteur — server-side direct

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { calculerCouleur } from '@/lib/coloration'
import { signPhotoPaths } from '@/lib/photos-access'
import { getPreviousIsoWeek, getWeekBounds, formatSemaineLabel } from '@/lib/reporting/isoWeek'
import type {
  Chantier,
  TacheWithUser,
  AffectationWithUser,
  PhotoConducteurDisplay,
} from '@/types/database'
import type { CompteRenduListe, RapportHebdoListe } from '@/types/reporting'
import { ChantierDetailConducteurClient } from './client'
import { SectionAlertesChantier } from '@/components/derives/SectionAlertesChantier'
import { SectionBriefingChantier } from '@/components/briefing/SectionBriefingChantier'

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

  // JWT re-valide via getUser() — pattern conducteur existant (lignes 39-45 originales)
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

  // Semaine ISO précédente — calculée server-side (évite hydration/timezone côté client)
  const { anneeIso: prevAnneeIso, semaineIso: prevSemaineIso } = getPreviousIsoWeek(new Date())
  const { lundi: prevLundi } = getWeekBounds(prevAnneeIso, prevSemaineIso)
  const previousWeek = {
    anneeIso: prevAnneeIso,
    semaineIso: prevSemaineIso,
    label: formatSemaineLabel(prevAnneeIso, prevSemaineIso),
    lundi: prevLundi,
  }

  const couleur = calculerCouleur(
    {
      date_fin_prevue: chantier.date_fin_prevue,
      budget_alloue: chantier.budget_alloue,
      budget_depense: chantier.budget_depense,
    },
    new Date(),
  )
  const couleurStyles = COULEUR_MAP[couleur]

  // Récupérer les tâches — Sprint 4 : ajout note_privee_conducteur (D-4-010, S4-F02)
  // AUDIT: SELECT explicite avec note_privee_conducteur pour le conducteur (D-4-010)
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

  // Récupérer les affectations — Sprint 4 : ajout telephone dans le join users (S4-F02, RG-TEL-001)
  // K4-MED-13 : telephone filtre par organisation_id du JWT (RLS org JWT)
  const { data: affectationsRaw } = await adminClient
    .from('affectations')
    .select(`
      id, user_id, chantier_id, organisation_id, vue, date_debut, date_fin, created_by, created_at,
      user:users!affectations_user_id_fkey (nom, prenom, role, telephone)
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
    .is('deleted_at', null)
    .order('prenom', { ascending: true })

  const membres = (membresRaw ?? []) as Array<{
    id: string
    nom: string
    prenom: string
    role: 'ouvrier' | 'conducteur'
  }>

  // Sprint 5 — CRs journaliers (liste compacte — sans contenu_genere/donnees_brutes)
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

  // Sprint 5 — Rapports hebdo (liste compacte)
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

  // Sprint 4 — F005/D-4-019 : photos fetchées server-side (pas d'endpoint REST GET conducteur)
  // SELECT photos filtre par organisation_id du JWT (K4-CR-02 — isolation org BINDING)
  // storage_path lu internalement pour signPhotoPaths, JAMAIS transmis au client
  const tacheIds = taches.map((t) => t.id)
  let photosConducteur: PhotoConducteurDisplay[] = []

  if (tacheIds.length > 0) {
    const { data: photosRaw, error: photosError } = await adminClient
      .from('photos')
      .select('id, tache_id, storage_path, commentaire, uploader_id, created_at')
      .in('tache_id', tacheIds)
      .eq('organisation_id', organisationId) // K4-CR-02 : isolation org par filtre JWT
      .order('created_at', { ascending: false })

    if (photosError) {
      // Non-bloquant — la page s'affiche sans photos (best-effort)
      // Log sans storage_path (K4-MED-04 redact actif)
    } else if (photosRaw && photosRaw.length > 0) {
      // Batch signPhotoPaths — 1 round-trip pour N chemins (D-4-004)
      const storagePaths = [...new Set(photosRaw.map((p) => p.storage_path))]
      const signedUrlMap = await signPhotoPaths(storagePaths)

      // Mapper vers PhotoConducteurDisplay — storage_path JAMAIS transmis au client (D-4-006)
      // uploader_nom optionnel : non fetch ici pour eviter un join supplementaire (perf S4)
      photosConducteur = photosRaw.map((p) => ({
        id: p.id,
        tache_id: p.tache_id,
        commentaire: p.commentaire,
        created_at: p.created_at,
        uploader_id: p.uploader_id,
        // storage_path INTENTIONNELLEMENT ABSENT — K4-NPR-01, D-4-006
        signed_url: signedUrlMap.get(p.storage_path) ?? '',
      }))
    }
  }

  return (
    <>
      {/*
        Bloc contextuel — ConducteurHeader du layout porte le chrome (logo + NotificationBell + avatar).
        Ce bloc porte uniquement le contexte de navigation : retour + nom + badge couleur + client.
        Stylistiquement aligné avec l'en-tête dark pour préserver la continuité visuelle.
      */}
      <div className="bg-primary-dark px-4 py-4">
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
      </div>

      {/* Sprint 6 — Section alertes proactives (F001 BINDING : avant les onglets, ancre id="alertes" dans SectionAlertesChantier) */}
      <SectionAlertesChantier chantierId={chantierId} />

      {/* Sprint 7 — Section briefing de la semaine (V-7-14 BINDING : visible sans clic supplémentaire)
          D-7-15 BINDING : distinction bleu (briefing prospectif) vs vert (rapport rétrospectif Sprint 5)
          role="conducteur" → "Voir le briefing complet" → /conducteur/briefings/[id]
          data-testid="section-briefing-chantier" dans SectionBriefingChantier */}
      <SectionBriefingChantier chantierId={chantierId} role="conducteur" />

      {/* Client Component pour les interactions (tâches + affectation + photos + CRs) */}
      <ChantierDetailConducteurClient
        chantier={chantier}
        chantierId={chantierId}
        taches={taches}
        affectations={affectations}
        membres={membres}
        photos={photosConducteur}
        crs={crs}
        rapportsHebdo={rapportsHebdo}
        previousWeek={previousWeek}
        currentUserId={user.id}
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
      </nav>
    </>
  )
}
