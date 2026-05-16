import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

// ============================================================
// Hiérarchie d'erreurs applicatives ClawBTP
// ============================================================

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(code)
    this.name = 'AppError'
    // Préserve la stack trace pour les logs internes (jamais exposée en réponse)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource}_NOT_FOUND`, 404)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super('FORBIDDEN', 403)
    this.name = 'ForbiddenError'
  }
}

export class ValidationError extends AppError {
  constructor(public readonly fields: Record<string, string[]>) {
    super('VALIDATION_FAILED', 400)
    this.name = 'ValidationError'
  }
}

// D-012 — Trial expiré : toutes mutations retournent 402
export class PaymentRequiredError extends AppError {
  constructor() {
    super('PAYMENT_REQUIRED', 402)
    this.name = 'PaymentRequiredError'
  }
}

// ============================================================
// Messages d'erreur publics (I-03 — jamais de message interne en prod)
// ============================================================

const PUBLIC_MESSAGES: Record<number, string> = {
  400: 'Requête invalide.',
  401: 'Non authentifié.',
  402: "Votre essai gratuit a expiré. Passez à un plan payant pour continuer à créer et modifier vos données.",
  403: 'Accès refusé.',
  404: 'Ressource introuvable.',
  429: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.',
  500: 'Une erreur interne est survenue.',
}

function getPublicMessage(statusCode: number): string {
  return PUBLIC_MESSAGES[statusCode] ?? 'Une erreur est survenue.'
}

// ============================================================
// Convertisseur d'erreurs -> NextResponse (I-03)
// Jamais de stack trace, jamais de message interne en production.
// ============================================================

export function toApiResponse(
  error: unknown,
  correlationId?: string,
): NextResponse {
  // Erreurs applicatives connues
  if (error instanceof ValidationError) {
    return NextResponse.json(
      {
        error: getPublicMessage(400),
        fields: error.fields,
        ...(correlationId && { correlationId }),
      },
      { status: 400 },
    )
  }

  if (error instanceof AppError) {
    // Log interne avec la vraie info (I-03 — log structuré, pas de stack trace en réponse)
    logger.warn(
      {
        errorCode: error.code,
        statusCode: error.statusCode,
        ...(correlationId && { correlationId }),
        // stack uniquement en développement et uniquement dans les logs, jamais en réponse
        ...(process.env['NODE_ENV'] !== 'production' && { stack: error.stack }),
      },
      `AppError: ${error.code}`,
    )

    return NextResponse.json(
      {
        error: getPublicMessage(error.statusCode),
        ...(correlationId && { correlationId }),
      },
      { status: error.statusCode },
    )
  }

  // Erreur inconnue — log complet en interne, message générique en réponse (I-03)
  logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
      ...(correlationId && { correlationId }),
      ...(process.env['NODE_ENV'] !== 'production' &&
        error instanceof Error && { stack: error.stack }),
    },
    'Unhandled error',
  )

  return NextResponse.json(
    {
      error: getPublicMessage(500),
      ...(correlationId && { correlationId }),
    },
    { status: 500 },
  )
}
