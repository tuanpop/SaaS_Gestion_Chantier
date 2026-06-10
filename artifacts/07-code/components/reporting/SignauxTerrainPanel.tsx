'use client'

// components/reporting/SignauxTerrainPanel.tsx — Affichage signaux terrain (aperçu CR)
// TST-K5-05 : n'affiche pas note_privee_conducteur ni storage_path ni signed_url
// Données reçues depuis donnees_brutes (type SignauxTerrain — D-008)

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { SignauxTerrain } from '@/types/reporting'

interface SignauxTerrainPanelProps {
  signaux: SignauxTerrain
}

const STATUT_TACHE_LABEL: Record<string, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  bloque: 'Bloqué',
  termine: 'Terminé',
}

export function SignauxTerrainPanel({ signaux }: SignauxTerrainPanelProps) {
  const { taches, photos_du_jour: photos, budget } = signaux

  return (
    <div className="space-y-4">
      {/* Tâches */}
      <Card className="border-2 border-black">
        <CardHeader className="pb-2 pt-4 px-4">
          <h4 className="text-xs font-heading font-bold uppercase tracking-wide text-[#555555]">
            Tâches ({taches.length})
          </h4>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {taches.length === 0 ? (
            <p className="text-xs text-[#555555]">Aucune tâche active ce jour.</p>
          ) : (
            <ul className="space-y-1.5">
              {taches.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <Badge
                    variant={t.statut === 'bloque' ? 'danger' : t.statut === 'termine' ? 'success' : 'muted'}
                    className="shrink-0 mt-0.5"
                  >
                    {STATUT_TACHE_LABEL[t.statut] ?? t.statut}
                  </Badge>
                  <span className="text-[#222222] leading-snug">{t.titre}</span>
                  {t.bloque_raison && (
                    <span className="text-[#C00000] text-xs ml-1">— {t.bloque_raison}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Photos — NE PAS afficher storage_path ni signed_url (TST-K5-05) */}
      <Card className="border-2 border-black">
        <CardHeader className="pb-2 pt-4 px-4">
          <h4 className="text-xs font-heading font-bold uppercase tracking-wide text-[#555555]">
            Photos ({photos.length})
          </h4>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {photos.length === 0 ? (
            <p className="text-xs text-[#555555]">Aucune photo ce jour.</p>
          ) : (
            <ul className="space-y-1">
              {photos.map((p) => (
                <li key={p.id} className="text-xs text-[#555555]">
                  {p.commentaire
                    ? `"${p.commentaire}"`
                    : `Photo ajoutée le ${new Date(p.uploaded_at).toLocaleDateString('fr-FR')}`}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Budget — uniquement si données disponibles */}
      {budget && (
        <Card className="border-2 border-black">
          <CardHeader className="pb-2 pt-4 px-4">
            <h4 className="text-xs font-heading font-bold uppercase tracking-wide text-[#555555]">
              Budget
            </h4>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-2 gap-2 text-sm">
            {budget.alloue !== null && (
              <div>
                <span className="text-xs text-[#555555]">Alloué</span>
                <p className="font-bold text-[#222222]">
                  {budget.alloue.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                </p>
              </div>
            )}
            {budget.depense !== null && (
              <div>
                <span className="text-xs text-[#555555]">Dépensé</span>
                <p className="font-bold text-[#222222]">
                  {budget.depense.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
