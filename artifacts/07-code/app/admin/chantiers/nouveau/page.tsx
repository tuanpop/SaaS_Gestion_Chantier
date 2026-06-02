'use client'
// app/admin/chantiers/nouveau/page.tsx
// Formulaire création chantier (admin) — migré react-hook-form (étape 5, D-2.5-016)
//
// Proto référencé : mockups/17-admin-chantier-nouveau.html
// Design system Hana : Card shadcn, Input brutal, Button brutal
// K2.5-D-06 : Button disabled={isSubmitting}
// RG-MIGR-003 : form aria-busy={isSubmitting}
// K2.5-T-10 : schema depuis lib/validation/chantiers.ts (jamais inline)
// K2.5-T-08 : toast description = JSX uniquement

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
// K2.5-T-10 — schema unique depuis lib/validation/
import { CreateChantierSchema, type CreateChantierInput } from '@/lib/validation/chantiers'

export default function NouveauChantierPage() {
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<CreateChantierInput>({
    resolver: zodResolver(CreateChantierSchema),
    defaultValues: {
      nom: '',
      client_nom: '',
      adresse: '',
      code_postal: '',
      budget_alloue: undefined,
      date_debut: '',
      date_fin_prevue: '',
    },
  })

  const { formState: { isSubmitting } } = form

  async function onSubmit(values: CreateChantierInput) {
    const response = await fetch('/api/chantiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })

    if (response.status === 402) {
      // K2.5-T-08 : description = JSX
      toast({
        variant: 'destructive',
        title: 'Essai expiré',
        description: <span>Votre essai a expiré — passez en payant pour créer un chantier.</span>,
      })
      return
    }

    if (response.status === 400) {
      const data = await response.json() as {
        error?: string
        fields?: Record<string, string[]>
      }
      if (data.fields) {
        for (const [field, messages] of Object.entries(data.fields)) {
          form.setError(field as keyof CreateChantierInput, {
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

    const chantier = await response.json() as { id: string }
    toast({
      variant: 'success',
      title: 'Chantier créé',
      description: <span>Le chantier a été créé avec succès.</span>,
    })
    router.push(`/admin/chantiers/${chantier.id}`)
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/chantiers"
          className="text-xs text-muted flex items-center gap-1 mb-3 hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux chantiers
        </Link>
        <h1 className="font-heading font-bold text-[28px]">Nouveau chantier</h1>
      </div>

      {/* Formulaire */}
      <div className="card-brutal p-8 max-w-3xl">
        {/* RG-MIGR-003 : form aria-busy={isSubmitting} */}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            aria-busy={isSubmitting}
          >

            {/* Nom du chantier */}
            <FormField
              control={form.control}
              name="nom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Nom du chantier <span className="text-danger normal-case font-normal">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Ex : Résidence Les Pins"
                      maxLength={100}
                      data-testid="chantier-nom"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Client */}
            <FormField
              control={form.control}
              name="client_nom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Client <span className="text-danger normal-case font-normal">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Nom du client ou de la société"
                      maxLength={200}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Adresse */}
            <FormField
              control={form.control}
              name="adresse"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Adresse <span className="text-danger normal-case font-normal">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="14 rue des Lilas"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Code postal — US-010 S2 validation inline */}
            <FormField
              control={form.control}
              name="code_postal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Code postal <span className="text-danger normal-case font-normal">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="75001"
                      maxLength={5}
                      inputMode="numeric"
                      pattern="\d{5}"
                      data-testid="chantier-code-postal"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Budget alloué (optionnel) */}
            <FormField
              control={form.control}
              name="budget_alloue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Budget alloué (€){' '}
                    <span className="text-muted font-normal normal-case text-xs">(optionnel)</span>
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-bold text-lg">€</span>
                      <Input
                        {...field}
                        type="text"
                        inputMode="numeric"
                        placeholder="65 000"
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

            {/* Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date_debut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Date début <span className="text-danger normal-case font-normal">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                        data-testid="chantier-date-debut"
                      />
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
                    <FormLabel>
                      Date fin prévue <span className="text-danger normal-case font-normal">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                        min={form.watch('date_debut') || undefined}
                        data-testid="chantier-date-fin"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-4 pt-4">
              {/* K2.5-D-06 : Button disabled={isSubmitting} obligatoire */}
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="chantier-submit"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Création...
                  </span>
                ) : (
                  'Créer le chantier'
                )}
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/chantiers">Annuler</Link>
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  )
}
