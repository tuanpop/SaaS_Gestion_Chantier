import pino from 'pino'

// Champs redactés — jamais loggés en clair (I-03, I-04)
// qr_token ajouté : token AES-256-GCM des ouvriers (S-01)
// Sprint 3 extensions (K3-HI-06, K3-MED-06, K3-MED-12) :
//   - body.note_privee_conducteur : donnee interne conducteur (K3-MED-06)
//   - body.bloque_raison : PII potentielle (K3-HI-06)
//   - body.description : contenu libre potentiellement sensible (K3-MED-12)
//   - req.headers.cookie / req.headers.authorization : deja presents, confirmes Sprint 3
// Sprint 4 extensions (K4-MED-04, K4-MED-11, K4-MED-01) :
//   - signed_url / signedUrl : credential temporaire bucket prive TTL 1h (K4-MED-04)
//   - storage_path : revele org/tache/photo IDs, ne jamais exposer (D-4-006, K4-MED-11)
//   - commentaire : contenu libre utilisateur potentiellement sensible (K4-MED-01)
//   - file : buffer binaire photo (K4-MED-11)
const REDACTED_FIELDS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'qr_token',
  'req.headers.authorization',
  'req.headers.cookie',
  // Sprint 3 — K3-HI-06, K3-MED-06, K3-MED-12
  'body.note_privee_conducteur',
  'body.bloque_raison',
  'body.description',
  // Sprint 4 — K4-MED-04, K4-MED-11, K4-MED-01
  'signed_url',
  'signedUrl',
  'storage_path',
  'commentaire',
  'file',
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
