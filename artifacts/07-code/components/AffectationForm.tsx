'use client'
// components/AffectationForm.tsx
// Formulaire affectation ouvrier/conducteur au chantier — migré Dialog + Form (étape 5)
//
// D-2.5-016 — react-hook-form + zodResolver
// RG-MIGR-005 — Dialog shadcn (focus-trap géré Radix, NE PAS re-implémenter)
// K2.5-D-06 — Button disabled={isSubmitting}
// K2.5-T-10 — schema depuis lib/validation/affectations.ts

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
// K2.5-T-10 — schema unique depuis lib/validation/
import { CreateAffectationSchema, type CreateAffectationInput } from '@/lib/validation/affectations'

// ============================================================
// Types
// ============================================================

interface OuvrierOption {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface AffectationFormProps {
  chantierId: string
  ouvriers: OuvrierOption[]
  onSuccess: () => void
  onClose: () => void
}

// ============================================================
// AffectationForm — Dialog + react-hook-form
// ============================================================

export function AffectationForm({
  chantierId,
  ouvriers,
  onSuccess,
  onClose,
}: AffectationFormProps) {
  const today = new Date().toISOString().split('T')[0] ?? ''

  const form = useForm<CreateAffectationInput>({
    resolver: zodResolver(CreateAffectationSchema),
    defaultValues: {
      user_id: '',
      date_debut: today,
      date_fin: null,
    },
  })

  const { formState: { isSubmitting } } = form

  async function onSubmit(values: CreateAffectationInput) {
    const response = await fetch(`/api/chantiers/${chantierId}/affectations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: values.user_id,
        date_debut: values.date_debut,
        ...(values.date_fin ? { date_fin: values.date_fin } : {}),
        vue: 'mes_taches',
      }),
    })

    if (!response.ok) {
      const data = await response.json() as { error?: string }
      form.setError('root', {
        type: 'server',
        message: data.error ?? 'Une erreur est survenue.',
      })
      return
    }

    onSuccess()
  }

  return (
    // onOpenChange gère la fermeture navigateur nativement (Radix Dialog)
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md bg-cream">
        <DialogHeader>
          <DialogTitle>Affecter un membre</DialogTitle>
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
            {/* Sélection membre */}
            <FormField
              control={form.control}
              name="user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Membre de l&apos;équipe <span className="text-danger normal-case font-normal">*</span>
                  </FormLabel>
                  {ouvriers.length === 0 ? (
                    <p className="text-muted text-sm">Aucun membre disponible dans l&apos;équipe.</p>
                  ) : (
                    // Piège 7 component-mapping : data-testid sur SelectTrigger
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="affectation-user-select">
                          <SelectValue placeholder="-- Choisir un membre --" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ouvriers.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.prenom} {o.nom}
                            {o.role === 'conducteur' ? ' (conducteur)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date de début */}
            <FormField
              control={form.control}
              name="date_debut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Date de début <span className="text-danger normal-case font-normal">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} type="date" min={today} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date de fin (optionnelle) */}
            <FormField
              control={form.control}
              name="date_fin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Date de fin <span className="text-muted font-normal normal-case text-xs">(optionnel)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      min={form.watch('date_debut') || today}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Annuler
              </Button>
              {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Affectation...' : 'Affecter'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
