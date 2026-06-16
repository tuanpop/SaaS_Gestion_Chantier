'use client'
// components/chat/ClawWelcomeBanner.tsx — Bannière accueil Claw pour l'ouvrier
//
// Implements: US-082 (accueil Claw ouvrier sur page tâches/chantier mobile)
// EXI-8-06 BINDING : JSX pur — jamais dangerouslySetInnerHTML
//   Le contenu (contenu_accueil) est rendu via {contenu} — React échappe automatiquement
// D-051 BINDING : jamais note_privee_conducteur dans ce composant
//   Les données viennent de GET /api/ouvrier/accueil-claw — sans note privée
// Design : design-notes-sprint-8.md §6 (accueil ouvrier, identité Claw, violet)
// data-testid : data-testid="claw-welcome-banner"

interface ClawWelcomeBannerProps {
  contenu: string
  meteoDisponible: boolean
  llmUtilise: boolean
}

export function ClawWelcomeBanner({
  contenu,
  meteoDisponible,
  llmUtilise,
}: ClawWelcomeBannerProps) {
  return (
    <div
      data-testid="claw-welcome-banner"
      className="border-2 rounded-lg p-4 mb-4"
      style={{
        backgroundColor: 'var(--color-claw-welcome-bg)',
        borderColor: 'var(--color-claw-welcome-border)',
        boxShadow: '3px 3px 0 var(--color-claw-welcome-border)',
      }}
    >
      {/* En-tête — identité Claw */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-lg"
          aria-hidden
          style={{ color: 'var(--color-claw-welcome-icon)' }}
        >
          🦞
        </span>
        <h3
          className="font-heading font-bold text-sm"
          style={{ color: 'var(--color-claw-welcome-text)' }}
        >
          Bonjour, voici ta journée avec Claw
        </h3>
        {/* Badge météo */}
        {meteoDisponible && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 ml-auto">
            Météo
          </span>
        )}
        {/* Badge fallback si pas de LLM */}
        {!llmUtilise && (
          <span
            className="text-xs px-2 py-0.5 rounded-full ml-auto"
            style={{
              backgroundColor: 'var(--color-fallback-bg)',
              color: 'var(--color-fallback-text)',
              border: '1px solid var(--color-fallback-border)',
            }}
          >
            Mode simplifié
          </span>
        )}
      </div>

      {/* Contenu accueil — EXI-8-06 : JSX pur, jamais dangerouslySetInnerHTML */}
      <div
        data-testid="claw-welcome-contenu"
        className="text-sm whitespace-pre-wrap break-words"
        style={{ color: 'var(--color-claw-welcome-text)' }}
      >
        {contenu}
      </div>
    </div>
  )
}

export default ClawWelcomeBanner
