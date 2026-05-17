// app/(admin)/chantiers/page.tsx
// Portefeuille multi-chantiers — liste colorée, tri rouge>orange>vert
// Server Component — data fetching direct via createClient()
//
// Proto référencé : mockups/15-admin-dashboard.html (section "Marge par chantier")
// Design system Hana : grille 3 colonnes, card-brutal + pastille coloration
// Implémente : US-010 S1 S3 (liste + perf < 1s)

import Link from 'next/link'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculerCouleur, trierParCouleur } from '@/lib/coloration'
import { ChantierCard } from '@/components/ChantierCard'
import type { Chantier, ChantierWithColoration } from '@/types/database'

export const metadata = {
  title: 'Chantiers',
}

// Désactiver le cache Next.js (no-store) — données temps réel (US-010 S3)
export const dynamic = 'force-dynamic'

// ============================================================
// Page
// ============================================================

export default async function ChantiersAdminPage() {
  // T-01 — organisation_id et role lus depuis les headers injectés par le middleware,
  // jamais depuis app_metadata directement (pattern cohérent avec les routes API).
  // await headers() OBLIGATOIRE — Next.js 15 (D-011).
  const headerStore = await headers()
  const organisationId = headerStore.get('x-organisation-id')
  const userRole = headerStore.get('x-user-role')

  if (!organisationId || userRole !== 'admin') {
    // Le middleware aurait dû bloquer — fail-safe défense en profondeur.
    return (
      <div className="card-brutal p-8 text-center">
        <p className="text-danger font-semibold">Session invalide. Reconnectez-vous.</p>
      </div>
    )
  }

  // Récupérer les chantiers actifs via adminClient (types Sprint 2)
  const adminClient = createAdminClient()

  const { data: chantiersRaw, error } = await adminClient
    .from('chantiers')
    .select('*')
    .eq('organisation_id', organisationId)
    .eq('statut', 'actif')
    .order('date_fin_prevue', { ascending: true })

  const chantiers = (chantiersRaw ?? []) as unknown as Chantier[]

  const aujourdhui = new Date()

  // Calculer couleur + trier rouge > orange > vert côté serveur (B.1 coloration)
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

  // ============================================================
  // Rendu
  // ============================================================

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold text-[28px]">Chantiers</h1>
          <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6l3 13h12l3-13H3z"/><path d="M3 6L12 2l9 4"/>
            </svg>
            Trié par priorité : Dépassé → Dérive → Dans les temps
            {error && <span className="text-danger ml-2">Erreur de chargement</span>}
          </p>
        </div>
        <Link
          href="/admin/chantiers/nouveau"
          className="btn-brutal bg-accent text-white text-sm py-2 px-4"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Nouveau chantier
        </Link>
      </div>

      {/* État vide */}
      {chantiersTriés.length === 0 && !error && (
        <div className="card-brutal p-12 text-center">
          <svg className="w-16 h-16 text-muted mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <p className="font-heading text-xl font-bold mb-2">Aucun chantier actif</p>
          <p className="text-base text-muted mb-6">Créez votre premier chantier pour commencer le suivi.</p>
          <Link
            href="/admin/chantiers/nouveau"
            className="btn-brutal bg-accent text-white"
          >
            Créer un chantier
          </Link>
        </div>
      )}

      {/* Erreur DB */}
      {error && (
        <div className="card-brutal p-6 border-l-4 border-l-danger bg-danger-bg mb-6">
          <p className="text-danger font-semibold">Erreur lors du chargement des chantiers.</p>
        </div>
      )}

      {/* Grille des chantiers — 3 colonnes desktop */}
      {chantiersTriés.length > 0 && (
        <div className="grid grid-cols-3 gap-5">
          {chantiersTriés.map((chantier) => (
            <ChantierCard
              key={chantier.id}
              chantier={chantier}
              href={`/admin/chantiers/${chantier.id}`}
              variant="desktop"
            />
          ))}
        </div>
      )}
    </div>
  )
}
