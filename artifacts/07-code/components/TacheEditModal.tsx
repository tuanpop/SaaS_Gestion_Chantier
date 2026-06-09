'use client'
// components/TacheEditModal.tsx — Modale d'édition tâche (CRUD UPDATE — réassignation + titre + description + échéance)
//
// Gap CRUD UPDATE tâche (2026-06-09) : le backend PATCH /api/taches/[id] était prêt ;
// l'UI n'exposait pas l'édition. Ce composant ferme le gap pour admin ET conducteur.
//
// Implémente :
//   - UpdateTacheSchema côté client (K2.5-T-10 : schéma unique depuis lib/validation/taches.ts)
//   - assigned_to : Select des membres assignables, option "Non assigné" = null (RG-REASSIGN-001)
//   - Pré-remplissage avec les valeurs courantes de la tâche
//   - Submit → PATCH /api/taches/[id] → succès : fermer + callback onSuccess
//   - Gestion erreurs 400 (fields), 403, 404
//
// Design : mirror TacheCreateModal (neubrutalism, react-hook-form + zodResolver, Dialog shadcn)
// Sécurité : jamais console.log, zéro any, Zod validation, Button disabled={isSubmitting}

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { TacheWithUser } from '@/types/database'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { z } from 'zod'
import { useToast } from '@/lib/hooks/use-toast'
// K2.5-T-10 : schéma de référence importé depuis lib/validation/taches.ts
// UpdateTacheSchema est un ZodEffects (.refine) — on ne peut pas faire .pick() dessus.
// On déclare ici le sous-schéma client (champs exposés dans le modal) cohérent avec le backend.
// Note : statut, bloque_raison et note_privee_conducteur restent gérés par TacheItem.
import type { UpdateTacheInput } from '@/lib/validation/taches'

// ============================================================
// Sous-schéma client (subset de UpdateTacheSchema sans .refine)
// ============================================================
// Fix #6 (smoke prod Sprint 4) : note_privee_conducteur ajoutée pour admin + conducteur.
// K4-NPR-01 / D-051 / D-3-004 : ce champ est autorisé côté backend pour role=admin et conducteur.
// NON exposé à l'ouvrier (routes /api/ouvrier/* et TacheOuvrier type ne l'incluent pas — défense TS).

const TacheEditClientSchema = z.object({
  titre: z.string().min(1, 'Le titre est requis').max(200, 'Max 200 caractères'),
  description: z.string().max(2000).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  date_echeance: z.string().date().nullable().optional(),
  // Fix #6 : note interne — acceptée par PATCH /api/taches/[id] pour admin + conducteur
  note_privee_conducteur: z.string().max(2000).nullable().optional(),
})

type EditFormValues = z.infer<typeof TacheEditClientSchema>

// ============================================================
// Types
// ============================================================

export interface TacheEditModalMember {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface TacheEditModalProps {
  tache: TacheWithUser
  membres: TacheEditModalMember[]
  onSuccess: () => void
  onClose: () => void
}

// ============================================================
// Composant
// ============================================================

export function TacheEditModal({
  tache,
  membres,
  onSuccess,
  onClose,
}: TacheEditModalProps) {
  const { toast } = useToast()

  // Sous-schéma client : seuls les champs exposés dans le modal
  // On utilise UpdateTacheSchema.pick sur les champs concernés pour rester cohérent
  // avec la spec backend (K2.5-T-10 — schéma unique depuis lib/validation/taches.ts).
  // On ne revalide pas statut/bloque_raison/note_privee_conducteur ici (gérés ailleurs).
  const form = useForm<EditFormValues>({
    resolver: zodResolver(TacheEditClientSchema),
    defaultValues: {
      titre: tache.titre,
      description: tache.description ?? '',
      assigned_to: tache.assigned_to ?? null,
      date_echeance: tache.date_echeance ?? null,
      // Fix #6 : pré-remplissage note interne (null si absente)
      note_privee_conducteur: tache.note_privee_conducteur ?? null,
    },
  })

  const { formState: { isSubmitting } } = form

  async function onSubmit(values: EditFormValues) {
    // Construire le payload PATCH avec seulement les champs définis
    // Fix #6 : note_privee_conducteur incluse pour admin + conducteur (K4-NPR-01 : jamais exposé ouvrier)
    const patch: Partial<UpdateTacheInput> = {
      titre: values.titre,
      description: values.description || null,
      assigned_to: values.assigned_to,
      date_echeance: values.date_echeance || null,
      note_privee_conducteur: values.note_privee_conducteur ?? null,
    }

    const response = await fetch(`/api/taches/${tache.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })

    if (response.status === 403) {
      toast({
        variant: 'destructive',
        title: 'Accès refusé',
        description: <span>Vous n&apos;avez pas les droits pour modifier cette tâche.</span>,
      })
      return
    }

    if (response.status === 404) {
      toast({
        variant: 'destructive',
        title: 'Tâche introuvable',
        description: <span>Cette tâche n&apos;existe plus ou n&apos;appartient pas à votre organisation.</span>,
      })
      return
    }

    if (response.status === 400) {
      const data = await response.json() as { error?: string; fields?: Record<string, string[]> }
      if (data.fields) {
        for (const [field, messages] of Object.entries(data.fields)) {
          form.setError(field as keyof EditFormValues, {
            type: 'server',
            message: messages[0] ?? 'Champ invalide.',
          })
        }
      } else {
        form.setError('root', { type: 'server', message: data.error ?? 'Requête invalide.' })
      }
      return
    }

    if (!response.ok) {
      form.setError('root', { type: 'server', message: 'Une erreur est survenue. Réessayez.' })
      return
    }

    toast({
      title: 'Tâche mise à jour',
      description: 'Les modifications ont été enregistrées.',
    })
    onSuccess()
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg bg-cream max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier la tâche</DialogTitle>
        </DialogHeader>

        {/* Erreur serveur racine */}
        {form.formState.errors.root && (
          <div role="alert" className="px-4 py-3 bg-danger-bg border-2 border-danger text-danger text-sm rounded-[6px]">
            {form.formState.errors.root.message}
          </div>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            aria-busy={isSubmitting}
          >
            {/* Titre */}
            <FormField
              control={form.control}
              name="titre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Titre <span className="text-danger normal-case font-normal">*</span></FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Ex : Pose carrelage RDC"
                      maxLength={200}
                      data-testid="tache-edit-titre"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      placeholder="Détails de la tâche..."
                      className="resize-none h-24"
                      maxLength={2000}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date échéance */}
            <FormField
              control={form.control}
              name="date_echeance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date d&apos;échéance <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Note privée (interne) — Fix #6 : visible admin + conducteur, badge "Interne" */}
            {/* K4-NPR-01 / D-051 : JAMAIS exposé à l'ouvrier — ce modal n'est pas rendu côté ouvrier */}
            {/* K4-MED-14 : badge "Interne" permanent pour distinguer la note des champs publics */}
            <FormField
              control={form.control}
              name="note_privee_conducteur"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Note privée
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-300"
                      aria-label="Champ interne, non visible par l'ouvrier"
                    >
                      Interne
                    </span>
                    <span className="text-muted font-normal normal-case text-xs">(optionnel)</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      placeholder="Note visible conducteur + admin uniquement..."
                      className="resize-none h-24"
                      maxLength={2000}
                      data-testid="tache-edit-note-privee"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Assigné à — option "Non assigné" = null (RG-REASSIGN-001) */}
            {/* Piège 7 component-mapping : data-testid sur SelectTrigger (pas select natif) */}
            <FormField
              control={form.control}
              name="assigned_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assigné à <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                  <Select
                    onValueChange={(val) => field.onChange(val === '__none__' ? null : val)}
                    value={field.value ?? '__none__'}
                  >
                    <FormControl>
                      {/* Piège 7 : data-testid sur SelectTrigger */}
                      <SelectTrigger data-testid="tache-edit-assigned-to">
                        <SelectValue placeholder="— Non assignée —" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">— Non assignée —</SelectItem>
                      {membres.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.prenom} {m.nom} ({m.role === 'ouvrier' ? 'Ouvrier' : 'Conducteur'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Annuler
              </Button>
              {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
              <Button type="submit" disabled={isSubmitting} data-testid="tache-edit-submit">
                {isSubmitting ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
