// SERVEUR UNIQUEMENT — ce fichier ne doit JAMAIS être importé côté client ('use client')
// QR_ENCRYPTION_KEY : 32 bytes hex (côté serveur, jamais NEXT_PUBLIC_) — décision humaine 2026-05-14

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { logger } from '@/lib/logger'

// ============================================================
// Startup check — throw si QR_ENCRYPTION_KEY manquante (décision humaine 2026-05-14)
// Empêche un démarrage silencieux avec des tokens non chiffrés.
// ============================================================

function getEncryptionKey(): Buffer {
  const keyHex = process.env['QR_ENCRYPTION_KEY']

  if (!keyHex) {
    const message =
      'QR_ENCRYPTION_KEY est manquante. ' +
      'Générer avec : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      'et ajouter dans .env.local. ' +
      'DANGER : si cette clé change, tous les QR codes existants deviennent invalides.'
    logger.error({ startup: true }, message)
    throw new Error(message)
  }

  if (keyHex.length !== 64) {
    const message =
      `QR_ENCRYPTION_KEY doit être 64 caractères hexadécimaux (32 bytes). ` +
      `Longueur actuelle : ${keyHex.length} caractères.`
    logger.error({ startup: true, keyLength: keyHex.length }, message)
    throw new Error(message)
  }

  const keyBuffer = Buffer.from(keyHex, 'hex')
  if (keyBuffer.length !== 32) {
    throw new Error('QR_ENCRYPTION_KEY invalide — impossible de décoder en 32 bytes.')
  }

  return keyBuffer
}

// ============================================================
// Payload du QR code
// ============================================================

export interface QRPayload {
  user_id: string
  organisation_id: string
}

// ============================================================
// encryptQR — AES-256-GCM
// Format du token : base64url(iv:authTag:ciphertext)
// IV aléatoire 12 bytes inclus dans le token
// ============================================================

/**
 * Chiffre un payload QR avec AES-256-GCM.
 * Retourne un token base64url sécurisé.
 * Utiliser côté SERVEUR UNIQUEMENT.
 */
export function encryptQR(payload: QRPayload): string {
  const key = getEncryptionKey()

  // IV aléatoire 12 bytes (recommandé GCM)
  const iv = randomBytes(12)

  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const plaintext = JSON.stringify(payload)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  const authTag = cipher.getAuthTag()

  // Format : iv(12 bytes) + authTag(16 bytes) + ciphertext
  // Encodé en base64url pour être safe dans les URLs
  const combined = Buffer.concat([iv, authTag, encrypted])
  return combined.toString('base64url')
}

// ============================================================
// decryptQR — déchiffrement AES-256-GCM
// Throw si token invalide ou falsifié (S-01)
// ============================================================

/**
 * Déchiffre un token QR.
 * Throw si le token est invalide, falsifié, ou si l'authTag ne correspond pas.
 * Un token invalide doit retourner HTTP 401 générique (S-01).
 *
 * Utiliser côté SERVEUR UNIQUEMENT.
 */
export function decryptQR(token: string): QRPayload {
  const key = getEncryptionKey()

  let combined: Buffer
  try {
    combined = Buffer.from(token, 'base64url')
  } catch {
    throw new InvalidQRTokenError('Token QR : décodage base64url échoué')
  }

  // Format attendu : iv(12) + authTag(16) + ciphertext(variable)
  if (combined.length < 12 + 16 + 1) {
    throw new InvalidQRTokenError('Token QR : longueur insuffisante')
  }

  const iv = combined.subarray(0, 12)
  const authTag = combined.subarray(12, 28)
  const ciphertext = combined.subarray(28)

  let decrypted: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    decrypted = decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8')
  } catch {
    // S-01 : token falsifié -> erreur loggée, retour HTTP 401 générique par l'appelant
    throw new InvalidQRTokenError('Token QR : déchiffrement AES-256-GCM échoué (token falsifié ou clé incorrecte)')
  }

  let payload: unknown
  try {
    payload = JSON.parse(decrypted)
  } catch {
    throw new InvalidQRTokenError('Token QR : payload JSON invalide après déchiffrement')
  }

  // Validation de la structure du payload
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>)['user_id'] !== 'string' ||
    typeof (payload as Record<string, unknown>)['organisation_id'] !== 'string'
  ) {
    throw new InvalidQRTokenError('Token QR : payload ne correspond pas au schéma attendu')
  }

  return payload as QRPayload
}

// ============================================================
// Erreur spécifique QR token invalide
// Utilisée par les handlers pour retourner HTTP 401 générique (S-01)
// ============================================================

export class InvalidQRTokenError extends Error {
  constructor(internalMessage: string) {
    super(internalMessage)
    this.name = 'InvalidQRTokenError'
  }
}
