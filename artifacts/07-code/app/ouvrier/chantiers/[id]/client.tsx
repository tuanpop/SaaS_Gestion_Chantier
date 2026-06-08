'use client'
// app/ouvrier/chantiers/[id]/client.tsx
// OuvrierChantierClient — composant interactif pour la vue chantier ouvrier
//
// Responsabilites :
//   - Afficher les taches separees en "Mes taches" et "Toutes les taches"
//   - PATCH statut via useMutation TanStack Query
//   - Feedback toast pour les changements de statut
//   - Dispatcher TacheMienneCard vs TacheAutreCard selon is_mine (D-3-008)
//
// D-3-008 : JAMAIS passer description_complete a TacheAutreCard (TypeScript bloque)
// K3-HI-03 : la distinction mienne/autre est dans les types, pas dans les props

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/lib/hooks/use-toast'
import { TacheMienneCard } from '@/components/ouvrier/TacheMienneCard'
import { TacheAutreCard } from '@/components/ouvrier/TacheAutreCard'
import type { GetChantierOuvrierResponse, TacheMienne, TacheAutre } from '@/types/database'

interface OuvrierChantierClientProps {
  chantierId: string
  initialData: GetChantierOuvrierResponse
  // Sprint 4 — pour GalerieModale is_mine (point d'attention 6 du plan)
  ouvrierUserId: string
}

type PatchTacheInput = {
  tacheId: string
  statut: 'a_faire' | 'en_cours' | 'termine' | 'bloque'
  bloque_raison?: string | null
}

type PatchTacheResponse = {
  id: string
  statut: 'a_faire' | 'en_cours' | 'termine' | 'bloque'
  bloque_raison: string | null
  updated_at: string
}

export function OuvrierChantierClient({ chantierId, initialData, ouvrierUserId }: OuvrierChantierClientProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Etat local des taches (optimistic update possible — simplifie ici avec re-render)
  const [taches, setTaches] = useState<GetChantierOuvrierResponse['taches']>(initialData.taches)

  // Mutation PATCH statut via TanStack Query v5
  const mutation = useMutation<PatchTacheResponse, Error, PatchTacheInput>({
    mutationFn: async ({ tacheId, statut, bloque_raison }) => {
      const body: Record<string, unknown> = { statut }
      if (bloque_raison !== undefined) {
        body['bloque_raison'] = bloque_raison
      }

      const response = await fetch(`/api/ouvrier/taches/${tacheId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json() as { error?: string }
        throw new Error(errorData.error ?? 'Erreur lors de la mise a jour du statut.')
      }

      return response.json() as Promise<PatchTacheResponse>
    },
    onSuccess: (data) => {
      // Mettre a jour l'etat local des taches
      setTaches((prev) =>
        prev.map((t) => {
          if (t.id !== data.id) return t

          // Mettre a jour le statut et bloque_raison dans la tache
          if (t.is_mine) {
            return {
              ...t,
              statut: data.statut,
              bloque_raison: data.bloque_raison,
            } as TacheMienne
          }
          return { ...t, statut: data.statut } as TacheAutre
        }),
      )

      // Invalider le cache TanStack Query si necessaire
      void queryClient.invalidateQueries({ queryKey: ['ouvrier-chantier', chantierId] })

      // Toast de confirmation
      const statusLabels: Record<string, string> = {
        en_cours: 'Tache demarree',
        termine: 'Tache terminee',
        bloque: 'Blocage signale',
        a_faire: 'Statut mis a jour',
      }
      toast({
        title: statusLabels[data.statut] ?? 'Statut mis a jour',
        description: data.statut === 'bloque' ? 'Votre responsable a ete notifie.' : undefined,
      })
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  function handleChangerStatut(
    tacheId: string,
    statut: 'a_faire' | 'en_cours' | 'termine' | 'bloque',
    bloqueRaison?: string,
  ) {
    mutation.mutate({
      tacheId,
      statut,
      bloque_raison: bloqueRaison ?? null,
    })
  }

  // Separer les taches siennes et les autres (D-3-008)
  const mesTaches = taches.filter((t): t is TacheMienne => t.is_mine)
  const autresTaches = taches.filter((t): t is TacheAutre => !t.is_mine)

  const isMutating = mutation.status === 'pending'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Section "Mes taches" */}
      <section data-testid="ouvrier-mes-taches-section">
        <h2
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontWeight: 700,
            fontSize: '18px',
            color: '#163958',
            marginBottom: '12px',
            borderBottom: '2px solid #163958',
            paddingBottom: '8px',
          }}
        >
          Mes taches
          <span
            style={{
              marginLeft: '8px',
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '14px',
              fontWeight: 400,
              color: '#888888',
            }}
          >
            ({mesTaches.length})
          </span>
        </h2>

        {mesTaches.length === 0 ? (
          <p
            style={{
              fontFamily: '"Public Sans", sans-serif',
              fontSize: '14px',
              color: '#888888',
            }}
          >
            Aucune tache vous est assignee sur ce chantier.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {mesTaches.map((tache) => (
              <TacheMienneCard
                key={tache.id}
                tache={tache}
                ouvrierUserId={ouvrierUserId}
                onChangerStatut={handleChangerStatut}
                isLoading={isMutating}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section "Toutes les taches" (vue des autres) */}
      {autresTaches.length > 0 && (
        <section data-testid="ouvrier-autres-taches-section">
          <h2
            style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 700,
              fontSize: '18px',
              color: '#4A4A4A',
              marginBottom: '12px',
              borderBottom: '2px solid #E5E7EB',
              paddingBottom: '8px',
            }}
          >
            Autres taches du chantier
            <span
              style={{
                marginLeft: '8px',
                fontFamily: '"Public Sans", sans-serif',
                fontSize: '14px',
                fontWeight: 400,
                color: '#888888',
              }}
            >
              ({autresTaches.length})
            </span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {autresTaches.map((tache) => (
              // D-3-008 : TacheAutreCard ne recoit PAS description_complete
              // TypeScript bloque toute tentative de passer ce champ (K3-HI-03)
              <TacheAutreCard key={tache.id} tache={tache} />
            ))}
          </div>
        </section>
      )}

      {/* Contact conducteur (RG-VUE-004) */}
      <section
        style={{
          borderTop: '1px solid #E5E7EB',
          paddingTop: '16px',
        }}
      >
        <p
          style={{
            fontFamily: '"Public Sans", sans-serif',
            fontSize: '13px',
            color: '#888888',
          }}
        >
          Responsable :{' '}
          <strong style={{ color: '#163958' }}>
            {initialData.conducteur.prenom} {initialData.conducteur.nom}
          </strong>
          {initialData.conducteur.telephone && (
            <>
              {' '}—{' '}
              <a
                href={`tel:${initialData.conducteur.telephone}`}
                style={{ color: '#163958', textDecoration: 'underline' }}
              >
                {initialData.conducteur.telephone}
              </a>
            </>
          )}
        </p>
      </section>
    </div>
  )
}
