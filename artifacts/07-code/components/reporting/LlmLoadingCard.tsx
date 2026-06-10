'use client'

// components/reporting/LlmLoadingCard.tsx — Indicateur chargement génération LLM
// Affiché pendant POST /api/chantiers/[id]/cr/generer ou /rapports-hebdo/generer

import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface LlmLoadingCardProps {
  message?: string
}

export function LlmLoadingCard({
  message = 'Génération en cours…',
}: LlmLoadingCardProps) {
  return (
    <Card className="border-2 border-black">
      <CardContent className="flex items-center gap-3 py-6 px-4">
        <Loader2 className="h-5 w-5 animate-spin text-[#F97316] shrink-0" />
        <span className="text-sm font-medium text-[#222222]">{message}</span>
      </CardContent>
    </Card>
  )
}
