'use client'
// app/admin/settings/derives/SeuilsDerivesClient.tsx — Formulaire seuils dérives
// US-053 (CRUD seuils), US-055 (reset)
//
// F003 BINDING : ratio_budget affiché en % (min=50, max=99).
//   Conversion DB (0.80) ↔ UI (80%) : diviser/multiplier par 100.
// data-testid exacts (specs §10.5) :
//   "page-seuils-derives" (sur le wrapper de la page — porté par page.tsx)
//   "bandeau-seuils-defaut"
//   "btn-sauvegarder-seuils"
//   "btn-reset-seuils"
//
// Sécurité :
//   Validation Zod côté client (ratio_budget ∈ [0.50, 1) côté serveur) — feedback immédiat.
//   organisation_id jamais dans le formulaire — lu depuis JWT côté serveur (TST-K6-18).

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/lib/hooks/use-toast'
import type { SeuilsDerivesResponse } from '@/types/detection'

interface SeuilsDerivesClientProps {
  initialSeuils: SeuilsDerivesResponse
}

export function SeuilsDerivesClient({ initialSeuils }: SeuilsDerivesClientProps) {
  const { toast } = useToast()

  // F003 : ratio_budget affiché en % (ex: 0.85 → "85")
  const [ratioPercent, setRatioPercent] = useState<string>(
    String(Math.round(initialSeuils.ratio_budget * 100)),
  )
  const [joursBlocage, setJoursBlocage] = useState<string>(String(initialSeuils.jours_blocage))
  const [joursInactivite, setJoursInactivite] = useState<string>(String(initialSeuils.jours_inactivite))
  const [source, setSource] = useState<'db' | 'defaut'>(initialSeuils.source)
  const [saving, setSaving] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  // ============================================================
  // Sauvegarder (PATCH)
  // ============================================================

  async function handleSauvegarder() {
    const ratioParsed = parseFloat(ratioPercent)
    const blocageParsed = parseInt(joursBlocage, 10)
    const inactiviteParsed = parseInt(joursInactivite, 10)

    // Validation côté client (feedback rapide)
    if (isNaN(ratioParsed) || ratioParsed < 50 || ratioParsed > 99) {
      toast({
        variant: 'destructive',
        title: 'Valeur invalide',
        description: 'Le seuil budget doit être compris entre 50% et 99%.',
      })
      return
    }
    if (isNaN(blocageParsed) || blocageParsed < 1) {
      toast({
        variant: 'destructive',
        title: 'Valeur invalide',
        description: 'Les jours de blocage doivent être au minimum 1.',
      })
      return
    }
    if (isNaN(inactiviteParsed) || inactiviteParsed < 1) {
      toast({
        variant: 'destructive',
        title: 'Valeur invalide',
        description: "Les jours d'inactivité doivent être au minimum 1.",
      })
      return
    }

    setSaving(true)
    try {
      // F003 : conversion % → ratio DB (80% → 0.80)
      const ratio = ratioParsed / 100

      const res = await fetch('/api/organisations/me/seuils-derives', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ratio_budget: ratio,
          jours_blocage: blocageParsed,
          jours_inactivite: inactiviteParsed,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Erreur ${res.status}`)
      }

      const updated: SeuilsDerivesResponse = await res.json()
      // Mettre à jour le formulaire avec les valeurs sauvegardées
      setRatioPercent(String(Math.round(updated.ratio_budget * 100)))
      setJoursBlocage(String(updated.jours_blocage))
      setJoursInactivite(String(updated.jours_inactivite))
      setSource('db')

      toast({
        title: 'Seuils sauvegardés',
        description: 'Les nouveaux seuils seront appliqués lors du prochain contrôle automatique.',
      })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible de sauvegarder les seuils.',
      })
    } finally {
      setSaving(false)
    }
  }

  // ============================================================
  // Réinitialiser (DELETE)
  // ============================================================

  async function handleReset() {
    setResetting(true)
    try {
      const res = await fetch('/api/organisations/me/seuils-derives', { method: 'DELETE' })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Erreur ${res.status}`)
      }

      // Retour aux valeurs par défaut
      setRatioPercent('85')
      setJoursBlocage('3')
      setJoursInactivite('7')
      setSource('defaut')
      setResetDialogOpen(false)

      toast({
        title: 'Seuils réinitialisés',
        description: 'Les valeurs par défaut seront appliquées lors du prochain contrôle automatique.',
      })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible de réinitialiser les seuils.',
      })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Bandeau "seuils par défaut" */}
      {source === 'defaut' && (
        <div
          data-testid="bandeau-seuils-defaut"
          className="rounded-md border-2 border-[var(--color-primary)] bg-[var(--color-primary-bg)] px-4 py-3 text-[13px] text-[var(--color-primary-dark)]"
        >
          Vous utilisez actuellement les seuils par défaut. Personnalisez-les ci-dessous pour votre organisation.
        </div>
      )}

      {/* Formulaire */}
      <div className="space-y-4 max-w-sm">
        {/* ratio_budget — F003 BINDING : affiché en %, min=50, max=99 */}
        <div className="space-y-1">
          <Label htmlFor="input-ratio-budget" className="font-semibold">
            Seuil budget (%)
          </Label>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Alerte si les dépenses dépassent ce pourcentage du budget alloué.
          </p>
          <div className="flex items-center gap-2">
            <Input
              id="input-ratio-budget"
              type="number"
              min={50}
              max={99}
              step={1}
              value={ratioPercent}
              onChange={(e) => setRatioPercent(e.target.value)}
              className="w-24"
              aria-describedby="hint-ratio-budget"
            />
            <span className="text-[14px] font-medium">%</span>
          </div>
          <p id="hint-ratio-budget" className="text-[11px] text-[var(--color-text-muted)]">
            Entre 50% et 99% (borne sécurité)
          </p>
        </div>

        {/* jours_blocage */}
        <div className="space-y-1">
          <Label htmlFor="input-jours-blocage" className="font-semibold">
            Jours avant alerte tâche bloquée
          </Label>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Nombre de jours en statut &quot;Bloqué&quot; avant de déclencher une alerte.
          </p>
          <Input
            id="input-jours-blocage"
            type="number"
            min={1}
            step={1}
            value={joursBlocage}
            onChange={(e) => setJoursBlocage(e.target.value)}
            className="w-24"
          />
        </div>

        {/* jours_inactivite */}
        <div className="space-y-1">
          <Label htmlFor="input-jours-inactivite" className="font-semibold">
            Jours avant alerte inactivité
          </Label>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Nombre de jours sans activité (tâche ou photo) avant de déclencher une alerte.
          </p>
          <Input
            id="input-jours-inactivite"
            type="number"
            min={1}
            step={1}
            value={joursInactivite}
            onChange={(e) => setJoursInactivite(e.target.value)}
            className="w-24"
          />
        </div>
      </div>

      {/* Message info délai application (D-6-10) */}
      <p className="text-[12px] text-[var(--color-text-muted)] italic">
        Les nouveaux seuils seront appliqués lors du prochain contrôle automatique (demain matin à 07h00 UTC).
      </p>

      {/* Boutons */}
      <div className="flex gap-3">
        <Button
          data-testid="btn-sauvegarder-seuils"
          onClick={handleSauvegarder}
          disabled={saving}
        >
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </Button>

        <Button
          data-testid="btn-reset-seuils"
          variant="outline"
          onClick={() => setResetDialogOpen(true)}
          disabled={source === 'defaut'}
        >
          Réinitialiser aux valeurs par défaut
        </Button>
      </div>

      {/* Dialog confirmation reset */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser les seuils ?</DialogTitle>
            <DialogDescription>
              Les seuils personnalisés de votre organisation seront supprimés. Le système utilisera
              les valeurs par défaut (budget 85%, blocage 3j, inactivité 7j) lors du prochain contrôle.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={resetting}
            >
              {resetting ? 'Réinitialisation…' : 'Confirmer la réinitialisation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
