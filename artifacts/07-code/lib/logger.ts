import pino from 'pino'

// Champs redactés — jamais loggés en clair (I-03, I-04)
// qr_token ajouté : token AES-256-GCM des ouvriers (S-01)
const REDACTED_FIELDS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'qr_token',
  'req.headers.authorization',
  'req.headers.cookie',
]

const baseLogger = pino({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  redact: {
    paths: REDACTED_FIELDS,
    censor: '[REDACTED]',
  },
  // Format ISO timestamp
  timestamp: pino.stdTimeFunctions.isoTime,
  // En développement, activer pino-pretty si disponible
  ...(process.env['NODE_ENV'] !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
})

export const logger = baseLogger

/**
 * Crée un logger enfant avec correlationId injecté dans chaque ligne de log.
 * Le correlationId est généré dans le middleware (crypto.randomUUID())
 * et propagé dans tous les handlers de la requête.
 */
export function createRequestLogger(correlationId: string): pino.Logger {
  return baseLogger.child({ correlationId })
}
