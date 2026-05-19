// ============================================================
// lib/notifications/email-errors.ts — Mapping EmailSendError -> NextResponse
//
// Helper partagé DRY entre :
//   - app/api/users/route.ts (handleReviveConducteur)
//   - app/api/users/[id]/reinvite/route.ts
//
// Convention messages d'erreur (TECH_CONTEXT.md) :
//   - 503 service externe (Resend down) : message actionnable
//   - 429 rate limit : message actionnable
//   - 400 recipient invalide : message actionnable
//   - 500 générique : uniquement pour vraies erreurs internes
//   - Toujours du français côté UI
// ============================================================

import { NextResponse } from 'next/server'
import { EmailSendError } from '@/lib/notifications/email-layout'

/**
 * Mappe une erreur d'envoi email (EmailSendError ou inconnue) vers une NextResponse
 * avec le code HTTP et le message utilisateur appropriés.
 *
 * Pattern : caller catch(emailErr) { return mapEmailErrorToResponse(emailErr, correlationId) }
 */
export function mapEmailErrorToResponse(emailErr: unknown, correlationId: string): NextResponse {
  if (emailErr instanceof EmailSendError) {
    switch (emailErr.code) {
      case 'unverified_domain':
        return NextResponse.json(
          {
            error:
              "Le domaine d'envoi configuré dans RESEND_FROM_EMAIL n'est pas vérifié sur Resend. Vérifiez le domaine sur resend.com/domains ou changez la variable d'environnement pour un domaine déjà vérifié.",
          },
          { status: 503, headers: { 'X-Correlation-Id': correlationId } },
        )
      case 'rate_limit':
        return NextResponse.json(
          { error: "Trop d'emails envoyés récemment. Réessayez dans quelques minutes." },
          { status: 429, headers: { 'X-Correlation-Id': correlationId } },
        )
      case 'invalid_recipient':
        return NextResponse.json(
          { error: "L'adresse email du destinataire est invalide ou refusée par Resend." },
          { status: 400, headers: { 'X-Correlation-Id': correlationId } },
        )
      case 'missing_api_key':
        return NextResponse.json(
          {
            error:
              'Configuration serveur incomplète (RESEND_API_KEY manquante). Contactez le support.',
          },
          { status: 503, headers: { 'X-Correlation-Id': correlationId } },
        )
      case 'network':
        return NextResponse.json(
          {
            error:
              "Réseau injoignable pour envoyer l'email. Réessayez dans quelques instants.",
          },
          { status: 503, headers: { 'X-Correlation-Id': correlationId } },
        )
      // case 'http_error' — fallthrough vers 500 générique
    }
  }
  return NextResponse.json(
    { error: 'Lien généré mais email non envoyé. Réessayez dans quelques minutes.' },
    { status: 500, headers: { 'X-Correlation-Id': correlationId } },
  )
}
