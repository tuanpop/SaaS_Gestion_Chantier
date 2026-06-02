'use client'
// components/TacheCreateModal.tsx
// Modal création tâche — migré Dialog + Form react-hook-form (étape 5)
//
// D-2.5-016 — react-hook-form + zodResolver
// K2.5-D-06 — Button disabled={isSubmitting}
// RG-MIGR-003 — form aria-busy={isSubmitting}
// K2.5-T-10 — schema depuis lib/validation/taches.ts
// Piège 7 component-mapping : data-testid="admin-tache-assigned-to" sur SelectTrigger

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { TacheStatut } from '@/types/database'
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
import { useToast } from '@/lib/hooks/use-toast'
// K2.5-T-10 — schema unique depuis lib/validation/
import { CreateTacheSchema, type CreateTacheInput } from '@/lib/validation/taches'

// ============================================================
// Types
// ============================================================

export interface TacheCreateModalMember {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface TacheCreateModalProps {
  chantierId: string
  membres: TacheCreateModalMember[]
  onSuccess: () => void
  onClose: () => void
}

const STATUTS: { value: Exclude<TacheStatut, 'termine'>; label: string }[] = [
  { value: 'a_faire', label: 'À faire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' },
]

// ============================================================
// Composant
// ============================================================

export function TacheCreateModal({
  chantierId,
  membres,
  onSuccess,
  onClose,
}: TacheCreateModalProps) {
  const { toast } = useToast()

  const form = useForm<CreateTacheInput>({
    resolver: zodResolver(CreateTacheSchema),
    defaultValues: {
      titre: '',
      description: '',
      date_echeance: null,
      statut: 'a_faire',
      assigned_to: null,
      bloque_raison: null,
    },
  })

  const { formState: { isSubmitting }, watch } = form
  const currentStatut = watch('statut')

  async function onSubmit(values: CreateTacheInput) {
    const response = await fetch(`/api/chantiers/${chantierId}/taches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titre: values.titre,
        ...(values.description ? { description: values.description } : {}),
        ...(values.date_echeance ? { date_echeance: values.date_echeance } : {}),
        statut: values.statut,
        ...(values.statut === 'bloque' && values.bloque_raison ? { bloque_raison: values.bloque_raison } : {}),
        ...(values.assigned_to ? { assigned_to: values.assigned_to } : {}),
      }),
    })

    if (response.status === 402) {
      // K2.5-T-08 : description = JSX uniquement
      toast({
        variant: 'destructive',
        title: 'Essai expiré',
        description: <span>Votre essai a expiré — passez en payant pour créer des tâches.</span>,
      })
      return
    }

    if (response.status === 400) {
      const data = await response.json() as { error?: string; fields?: Record<string, string[]> }
      if (data.fields) {
        for (const [field, messages] of Object.entries(data.fields)) {
          form.setError(field as keyof CreateTacheInput, {
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

    onSuccess()
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg bg-cream max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle tâche</DialogTitle>
        </DialogHeader>

        {/* Erreur serveur */}
        {form.formState.errors.root && (
          <div role="alert" className="px-4 py-3 bg-danger-bg border-2 border-danger text-danger text-sm rounded-[6px]">
            {form.formState.errors.root.message}
          </div>
        )}

        {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
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
                      data-testid="tache-titre"
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

            {/* Assigner à — Piège 7 : data-testid sur SelectTrigger */}
            <FormField
              control={form.control}
              name="assigned_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assigner à <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                  <Select
                    onValueChange={(val) => field.onChange(val === '__none__' ? null : val)}
                    defaultValue="__none__"
                  >
                    <FormControl>
                      {/* Piège 7 component-mapping : data-testid sur SelectTrigger (pas select natif) */}
                      <SelectTrigger data-testid="admin-tache-assigned-to">
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

            {/* Statut initial */}
            <FormField
              control={form.control}
              name="statut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Statut initial</FormLabel>
                  <FormControl>
                    <div className="flex gap-2 flex-wrap">
                      {STATUTS.map(({ value, label }) => (
                        <Button
                          key={value}
                          type="button"
                          onClick={() => {
                            field.onChange(value)
                            if (value !== 'bloque') {
                              form.setValue('bloque_raison', null)
                            }
                          }}
                          variant={field.value === value ? 'default' : 'outline'}
                          size="sm"
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Raison blocage — conditionnel */}
            {currentStatut === 'bloque' && (
              <FormField
                control={form.control}
                name="bloque_raison"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Raison du blocage <span className="text-danger normal-case font-normal">*</span></FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Décrivez la raison du blocage (min. 10 caractères)"
                        className="resize-none h-24"
                        minLength={10}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Annuler
              </Button>
              {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
              <Button type="submit" disabled={isSubmitting} data-testid="tache-submit">
                {isSubmitting ? 'Création...' : 'Créer la tâche'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
