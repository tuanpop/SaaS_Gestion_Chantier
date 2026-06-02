'use client'
// app/conducteur/chantiers/[id]/taches/nouvelle/client.tsx
// Formulaire création tâche conducteur — migré react-hook-form (étape 5, formulaire 8)
//
// D-2.5-016 — react-hook-form + zodResolver
// K2.5-D-06 — Button disabled={isSubmitting}
// RG-MIGR-003 — form aria-busy={isSubmitting}
// K2.5-T-10 — schema depuis lib/validation/taches.ts
// D-2.5-019 : SVG bottom-nav conservés (5 onglets conducteur)

import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
import type { TacheStatut } from '@/types/database'

const STATUTS: { value: Exclude<TacheStatut, 'termine'>; label: string }[] = [
  { value: 'a_faire', label: 'À faire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'bloque', label: 'Bloqué' },
]

export interface AssignableMember {
  id: string
  nom: string
  prenom: string
  role: 'ouvrier' | 'conducteur'
}

interface NouvelleTacheClientProps {
  membres: AssignableMember[]
}

export function NouvelleTacheClient({ membres }: NouvelleTacheClientProps) {
  const router = useRouter()
  const { id: chantierId } = useParams() as { id: string }
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
      // K2.5-T-08 : description = JSX
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

    router.push(`/conducteur/chantiers/${chantierId}`)
  }

  return (
    <>
      {/* Header */}
      <header className="bg-primary-dark px-4 py-4">
        <Link
          href={`/conducteur/chantiers/${chantierId}`}
          className="text-white/70 text-xs flex items-center gap-1 mb-1"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Retour
        </Link>
        <h1 className="font-heading text-white text-lg font-bold">Nouvelle tâche</h1>
      </header>

      <main className="px-4 pt-4 pb-40">
        {/* Erreur serveur */}
        {form.formState.errors.root && (
          <div role="alert" className="card-brutal-mobile p-4 border-l-4 border-l-danger bg-danger-bg mb-4">
            <p className="text-danger font-semibold text-sm">
              {form.formState.errors.root.message}
            </p>
          </div>
        )}

        {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            aria-busy={isSubmitting}
          >

            <FormField
              control={form.control}
              name="titre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Titre <span className="text-danger normal-case font-normal">*</span></FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex : Pose carrelage RDC" maxLength={200} data-testid="tache-titre" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            {/* Assigner à — piège 7 : data-testid sur SelectTrigger */}
            <FormField
              control={form.control}
              name="assigned_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assigner à <span className="text-muted font-normal normal-case text-xs">(optionnel)</span></FormLabel>
                  <Select onValueChange={(val) => field.onChange(val === '__none__' ? null : val)} defaultValue="__none__">
                    <FormControl>
                      {/* data-testid sur SelectTrigger (piège 7) */}
                      <SelectTrigger data-testid="assigned-to-select">
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

            {/* Raison blocage */}
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

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-4">
              {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
              <Button type="submit" disabled={isSubmitting} size="lg" className="w-full" data-testid="tache-submit">
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Création...
                  </span>
                ) : (
                  'Créer la tâche'
                )}
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full">
                <Link href={`/conducteur/chantiers/${chantierId}`}>Annuler</Link>
              </Button>
            </div>
          </form>
        </Form>
      </main>

      {/* Bottom Navigation conducteur — D-2.5-019 : SVG conservés */}
      <nav className="bottom-nav">
        <Link href="/conducteur/chantiers">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Chantiers</span>
        </Link>
        <Link href="/conducteur/taches" className="active">
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
