'use client'
// app/admin/chantiers/[id]/modifier/client.tsx
// Client Component du formulaire de modification chantier — migré react-hook-form (étape 5)
//
// D-2.5-016 — react-hook-form + zodResolver
// K2.5-D-06 — Button disabled={isSubmitting}
// RG-MIGR-003 — form aria-busy={isSubmitting}
// K2.5-T-10 — schema depuis lib/validation/chantiers.ts (jamais inline)
// K2.5-T-08 — toast description = JSX uniquement

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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
import { useToast } from '@/lib/hooks/use-toast'
import type { Chantier } from '@/types/database'
// K2.5-T-10 — schema unique depuis lib/validation/
import { CreateChantierBaseSchema, dateOrderRefinement } from '@/lib/validation/chantiers'

// ModifierChantier étend CreateChantier en ajoutant budget_depense
const ModifierChantierSchema = CreateChantierBaseSchema.extend({
  budget_depense: z.number().min(0).optional(),
}).refine(dateOrderRefinement.check, {
  message: dateOrderRefinement.message,
  path: [...dateOrderRefinement.path],
})

type ModifierChantierInput = z.infer<typeof ModifierChantierSchema>

interface Props {
  chantier: Chantier
}

export function ModifierChantierClient({ chantier }: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<ModifierChantierInput>({
    resolver: zodResolver(ModifierChantierSchema),
    defaultValues: {
      nom: chantier.nom,
      client_nom: chantier.client_nom,
      adresse: chantier.adresse,
      code_postal: chantier.code_postal,
      budget_alloue: chantier.budget_alloue ?? undefined,
      budget_depense: chantier.budget_depense,
      date_debut: chantier.date_debut,
      date_fin_prevue: chantier.date_fin_prevue,
    },
  })

  const { formState: { isSubmitting } } = form

  async function onSubmit(values: ModifierChantierInput) {
    // PATCH payload minimal — seulement les champs modifiés
    const payload: Record<string, string | number | null> = {}
    if (values.nom !== chantier.nom) payload['nom'] = values.nom
    if (values.client_nom !== chantier.client_nom) payload['client_nom'] = values.client_nom
    if (values.adresse !== chantier.adresse) payload['adresse'] = values.adresse
    if (values.code_postal !== chantier.code_postal) payload['code_postal'] = values.code_postal
    if (values.budget_alloue !== chantier.budget_alloue) {
      if (values.budget_alloue !== undefined && values.budget_alloue > 0) {
        payload['budget_alloue'] = values.budget_alloue
      }
    }
    if (values.budget_depense !== undefined && values.budget_depense !== chantier.budget_depense) {
      payload['budget_depense'] = values.budget_depense
    }
    if (values.date_debut !== chantier.date_debut) payload['date_debut'] = values.date_debut
    if (values.date_fin_prevue !== chantier.date_fin_prevue) payload['date_fin_prevue'] = values.date_fin_prevue

    if (Object.keys(payload).length === 0) {
      toast({
        variant: 'default',
        title: 'Information',
        description: <span>Aucune modification à enregistrer.</span>,
      })
      return
    }

    const response = await fetch(`/api/chantiers/${chantier.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (response.status === 402) {
      toast({
        variant: 'destructive',
        title: 'Essai expiré',
        description: <span>Votre essai a expiré — passez en payant pour modifier ce chantier.</span>,
      })
      return
    }

    if (response.status === 400) {
      const data = (await response.json()) as { error?: string; fields?: Record<string, string[]> }
      if (data.fields) {
        for (const [field, messages] of Object.entries(data.fields)) {
          form.setError(field as keyof ModifierChantierInput, {
            type: 'server',
            message: messages[0] ?? 'Champ invalide.',
          })
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'Erreur',
          description: <span>{data.error ?? 'Requête invalide.'}</span>,
        })
      }
      return
    }

    if (!response.ok) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: <span>Une erreur est survenue. Réessayez.</span>,
      })
      return
    }

    toast({
      variant: 'success',
      title: 'Chantier mis à jour',
      description: <span>Les modifications ont été enregistrées.</span>,
    })
    router.push(`/admin/chantiers/${chantier.id}`)
    router.refresh()
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/admin/chantiers/${chantier.id}`}
          className="text-xs text-muted flex items-center gap-1 mb-3 hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au chantier
        </Link>
        <h1 className="font-heading font-bold text-[28px]">Modifier le chantier</h1>
        <p className="text-muted mt-1">{chantier.nom}</p>
      </div>

      <div className="card-brutal p-8 max-w-3xl">
        {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            aria-busy={isSubmitting}
          >

            <FormField
              control={form.control}
              name="nom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nom du chantier <span className="text-danger normal-case font-normal">*</span></FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={100} data-testid="modifier-chantier-nom" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="client_nom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client <span className="text-danger normal-case font-normal">*</span></FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="adresse"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresse <span className="text-danger normal-case font-normal">*</span></FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="code_postal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code postal <span className="text-danger normal-case font-normal">*</span></FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={5} inputMode="numeric" pattern="\d{5}" data-testid="modifier-chantier-code-postal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="budget_alloue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget alloué (€) <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-bold text-lg">€</span>
                        <Input
                          type="text"
                          inputMode="numeric"
                          className="pl-8"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\s/g, '')
                            field.onChange(val === '' ? undefined : Number(val))
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="budget_depense"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget dépensé (€)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-bold text-lg">€</span>
                        <Input
                          type="text"
                          inputMode="numeric"
                          className="pl-8"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\s/g, '')
                            field.onChange(val === '' ? 0 : Number(val))
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date_debut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date début <span className="text-danger normal-case font-normal">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="modifier-chantier-date-debut" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date_fin_prevue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date fin prévue <span className="text-danger normal-case font-normal">*</span></FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                        min={form.watch('date_debut') || undefined}
                        data-testid="modifier-chantier-date-fin"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex gap-4 pt-4">
              {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="modifier-chantier-submit"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Enregistrement...
                  </span>
                ) : (
                  'Enregistrer les modifications'
                )}
              </Button>
              <Button asChild variant="outline">
                <Link href={`/admin/chantiers/${chantier.id}`}>Annuler</Link>
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  )
}
