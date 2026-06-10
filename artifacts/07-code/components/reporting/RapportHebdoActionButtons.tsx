'use client'

// components/reporting/RapportHebdoActionButtons.tsx — Boutons d'action sur un rapport hebdo
// Actions disponibles selon statut :
//   brouillon → [Régénérer] [Valider → Dialog confirmation]
//   valide    → [Envoyer → Dialog "N membres"] [PDF]
//   envoye    → [PDF]
// D-007 BINDING : workflow brouillon→valide→envoye (pas de rétrogradation)
// PO-5-04 BINDING : dialog Envoyer affiche "N membres" — jamais la liste des emails

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { CheckCircle, Send, Download, RefreshCw, Loader2, Users } from 'lucide-react'
import type { StatutRapportHebdo } from '@/types/reporting'

interface RapportHebdoActionButtonsProps {
  rapportId: string
  chantierId: string
  statut: StatutRapportHebdo
  /**
   * Nombre de destinataires internes (admin + conducteur actifs de l'org).
   * Calculé server-side dans la page détail et passé en prop.
   * Affiché dans le dialog Envoyer — PO-5-04 : "Sera envoyé à N membres".
   */
  nbDestinataires: number
}

export function RapportHebdoActionButtons({
  rapportId,
  chantierId,
  statut,
  nbDestinataires,
}: RapportHebdoActionButtonsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Dialog state
  const [validerDialogOpen, setValiderDialogOpen] = useState(false)
  const [envoyerDialogOpen, setEnvoyerDialogOpen] = useState(false)

  async function executeAction(action: string, apiPath: string) {
    setLoading(action)
    setErrorMsg(null)
    try {
      const res = await fetch(apiPath, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrorMsg((data as { error?: string }).error ?? 'Une erreur est survenue.')
        return
      }
      router.refresh()
    } catch {
      setErrorMsg('Erreur réseau. Veuillez réessayer.')
    } finally {
      setLoading(null)
    }
  }

  async function handleValiderConfirm() {
    setValiderDialogOpen(false)
    await executeAction('valider', `/api/rapports-hebdo/${rapportId}/valider`)
  }

  async function handleEnvoyerConfirm() {
    setEnvoyerDialogOpen(false)
    await executeAction('envoyer', `/api/rapports-hebdo/${rapportId}/envoyer`)
  }

  function handleDownloadPdf() {
    window.open(`/api/rapports-hebdo/${rapportId}/pdf`, '_blank', 'noopener')
  }

  const isBusy = loading !== null

  return (
    <div className="space-y-2">
      {errorMsg && (
        <p className="text-sm text-[#C00000] font-medium border-2 border-[#C00000] rounded px-3 py-2 bg-[#FFCCCC]">
          {errorMsg}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Brouillon : Régénérer + Valider (avec dialog) */}
        {statut === 'brouillon' && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              data-testid="btn-regenerer-rapport-hebdo"
              onClick={() =>
                executeAction(
                  'regenerer',
                  `/api/chantiers/${chantierId}/rapports-hebdo/generer`,
                )
              }
              className="border-2 border-black"
            >
              {loading === 'regenerer' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Régénérer
            </Button>

            {/* Bouton Valider — ouvre le dialog de confirmation */}
            <Button
              size="sm"
              disabled={isBusy}
              data-testid="btn-valider-rapport-hebdo"
              onClick={() => setValiderDialogOpen(true)}
              className="bg-[#1E6B3C] text-white border-2 border-[#1E6B3C] hover:bg-[#155A30]"
            >
              {loading === 'valider' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              )}
              Valider
            </Button>
          </>
        )}

        {/* Valide : Envoyer (avec dialog) + PDF */}
        {statut === 'valide' && (
          <>
            {/* Bouton Envoyer — ouvre le dialog "N membres" */}
            <Button
              size="sm"
              disabled={isBusy}
              data-testid="btn-envoyer-rapport-hebdo"
              onClick={() => setEnvoyerDialogOpen(true)}
              className="bg-[#1F4E79] text-white border-2 border-[#1F4E79] hover:bg-[#163958]"
            >
              {loading === 'envoyer' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              Envoyer
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="btn-export-pdf-hebdo"
              onClick={handleDownloadPdf}
              className="border-2 border-black"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              PDF
            </Button>
          </>
        )}

        {/* Envoyé : PDF uniquement */}
        {statut === 'envoye' && (
          <Button
            variant="outline"
            size="sm"
            data-testid="btn-export-pdf-hebdo"
            onClick={handleDownloadPdf}
            className="border-2 border-black"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Télécharger PDF
          </Button>
        )}
      </div>

      {/* Dialog confirmation Valider */}
      <Dialog open={validerDialogOpen} onOpenChange={setValiderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-[#1E6B3C]" />
              Valider ce rapport hebdomadaire ?
            </DialogTitle>
            <DialogDescription>
              Une fois validé, ce rapport ne pourra plus être modifié ni régénéré. Votre
              validation sera enregistrée (nom + date).
            </DialogDescription>
          </DialogHeader>
          <div className="bg-[#E2EFDA] border-2 border-[#1E6B3C] rounded-[6px] px-3 py-2 text-sm text-[#1E6B3C]">
            Aucun email n&apos;est envoyé automatiquement après la validation. Vous pourrez
            envoyer le rapport séparément.
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="border-2 border-black"
              onClick={() => setValiderDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button
              data-testid="btn-valider-rapport-hebdo-confirm"
              disabled={isBusy}
              onClick={handleValiderConfirm}
              className="bg-[#1E6B3C] text-white border-2 border-[#1E6B3C] hover:bg-[#155A30]"
            >
              {loading === 'valider' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              )}
              Confirmer la validation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmation Envoyer — PO-5-04 BINDING : N membres, jamais liste d'emails */}
      <Dialog open={envoyerDialogOpen} onOpenChange={setEnvoyerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-[#1F4E79]" />
              Envoyer ce rapport par email ?
            </DialogTitle>
            <DialogDescription>
              Une fois envoyé, ce rapport passera en statut &ldquo;Envoyé&rdquo;. Cette action
              est irréversible.
            </DialogDescription>
          </DialogHeader>
          {/* Récapitulatif destinataires — PO-5-04 BINDING : N membres, jamais les emails */}
          <div className="bg-[#D6E4F0] border-2 border-[#1F4E79] rounded-[6px] px-3 py-2">
            <p className="text-sm font-semibold text-[#1F4E79] flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5" />
              Sera envoyé à {nbDestinataires} membre{nbDestinataires !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-[#555555]">
              Liste automatique — admins et conducteurs actifs de l&apos;organisation.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="border-2 border-black"
              onClick={() => setEnvoyerDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button
              data-testid="btn-envoyer-rapport-hebdo-confirm"
              disabled={isBusy}
              onClick={handleEnvoyerConfirm}
              className="bg-[#1F4E79] text-white border-2 border-[#1F4E79] hover:bg-[#163958]"
            >
              {loading === 'envoyer' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              Confirmer l&apos;envoi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
