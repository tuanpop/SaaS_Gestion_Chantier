/**
 * tests/unit/crypto.test.ts — Tests unitaires Vitest pour lib/crypto.ts
 *
 * Scénarios couverts (SPRINT_1_PLAN.md §7.2) :
 *   1. Round-trip encrypt/decrypt préserve le payload
 *   2. Token falsifié (1 char modifié) -> throws
 *   3. Token avec mauvaise authTag -> throws
 *
 * Prérequis :
 *   QR_ENCRYPTION_KEY doit être définie dans l'environnement de test.
 *   Le vitest.config.ts doit charger .env.test ou définir QR_ENCRYPTION_KEY.
 *
 * SERVEUR UNIQUEMENT : crypto.ts ne peut jamais être importé côté client.
 * Dans Vitest (Node.js), cette contrainte est respectée automatiquement.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { encryptQR, decryptQR, InvalidQRTokenError } from '../../lib/crypto'
import type { QRPayload } from '../../lib/crypto'

// ============================================================
// Setup : définir QR_ENCRYPTION_KEY si absente (test uniquement)
// Une clé fixe de 64 hex chars (32 bytes) utilisée UNIQUEMENT dans les tests
// Ne jamais utiliser cette clé en production
// ============================================================

const TEST_ENCRYPTION_KEY = 'a'.repeat(64) // 64 caractères hex = 32 bytes — TEST UNIQUEMENT

beforeAll(() => {
  if (!process.env['QR_ENCRYPTION_KEY']) {
    process.env['QR_ENCRYPTION_KEY'] = TEST_ENCRYPTION_KEY
  }

  // Vérification que la clé est valide (64 hex chars)
  const key = process.env['QR_ENCRYPTION_KEY']
  if (key.length !== 64) {
    throw new Error(
      `QR_ENCRYPTION_KEY doit être 64 caractères hexadécimaux. Longueur actuelle: ${key.length}`,
    )
  }
})

// ============================================================
// Payload de test
// ============================================================

const TEST_PAYLOAD: QRPayload = {
  user_id: '123e4567-e89b-12d3-a456-426614174000',
  organisation_id: '987fcdeb-51a2-43d7-b890-426614174999',
}

// ============================================================
// Tests
// ============================================================

describe('encryptQR / decryptQR', () => {

  // ----------------------------------------------------------
  // Scénario 1 : Round-trip encrypt -> decrypt préserve le payload
  // ----------------------------------------------------------

  it('GIVEN un payload valide WHEN encryptQR() puis decryptQR() THEN le payload est préservé', () => {
    const token = encryptQR(TEST_PAYLOAD)

    // Le token doit être une string non-vide
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)

    // Le token doit être en base64url (pas de +, /, = standard base64)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)

    const decrypted = decryptQR(token)

    expect(decrypted.user_id).toBe(TEST_PAYLOAD.user_id)
    expect(decrypted.organisation_id).toBe(TEST_PAYLOAD.organisation_id)
  })

  it('GIVEN deux appels encryptQR avec le même payload WHEN THEN les tokens sont différents (IV aléatoire)', () => {
    const token1 = encryptQR(TEST_PAYLOAD)
    const token2 = encryptQR(TEST_PAYLOAD)

    // IV aléatoire 12 bytes -> chaque token est différent
    expect(token1).not.toBe(token2)

    // Mais les deux déchiffrent vers le même payload
    expect(decryptQR(token1)).toEqual(TEST_PAYLOAD)
    expect(decryptQR(token2)).toEqual(TEST_PAYLOAD)
  })

  // ----------------------------------------------------------
  // Scénario 2 : Token falsifié (1 char modifié) -> throws
  // ----------------------------------------------------------

  it('GIVEN un token falsifié (1 caractère modifié) WHEN decryptQR() THEN throws InvalidQRTokenError', () => {
    const token = encryptQR(TEST_PAYLOAD)

    // Modifier le dernier caractère du token (touche le ciphertext)
    const lastChar = token.charAt(token.length - 1)
    const altChar = lastChar === 'A' ? 'B' : 'A'
    const tamperedToken = token.slice(0, -1) + altChar

    expect(() => decryptQR(tamperedToken)).toThrow(InvalidQRTokenError)
  })

  it('GIVEN un token tronqué WHEN decryptQR() THEN throws InvalidQRTokenError', () => {
    const token = encryptQR(TEST_PAYLOAD)

    // Tronquer : retirer les 10 derniers chars (touche le ciphertext)
    const truncatedToken = token.slice(0, -10)

    expect(() => decryptQR(truncatedToken)).toThrow(InvalidQRTokenError)
  })

  // ----------------------------------------------------------
  // Scénario 3 : Token avec mauvaise authTag -> throws
  // Le format est : iv(12 bytes) + authTag(16 bytes) + ciphertext
  // Modifier l'authTag (bytes 12-27 dans le buffer) invalide le GCM
  // ----------------------------------------------------------

  it('GIVEN un token avec authTag corrompu WHEN decryptQR() THEN throws InvalidQRTokenError', () => {
    const token = encryptQR(TEST_PAYLOAD)

    // Décoder en base64url pour manipuler les bytes
    const combined = Buffer.from(token, 'base64url')

    // L'authTag se trouve en bytes 12-27 (après les 12 bytes d'IV)
    // On modifie le premier byte de l'authTag
    const tampered = Buffer.from(combined)
    tampered[12] = tampered[12] ^ 0xFF  // XOR pour corrompre le byte

    const tamperedToken = tampered.toString('base64url')

    expect(() => decryptQR(tamperedToken)).toThrow(InvalidQRTokenError)
  })

  it('GIVEN un token avec IV corrompu WHEN decryptQR() THEN throws InvalidQRTokenError', () => {
    const token = encryptQR(TEST_PAYLOAD)

    // Corrompre le premier byte de l'IV
    const combined = Buffer.from(token, 'base64url')
    const tampered = Buffer.from(combined)
    tampered[0] = tampered[0] ^ 0xFF

    const tamperedToken = tampered.toString('base64url')

    expect(() => decryptQR(tamperedToken)).toThrow(InvalidQRTokenError)
  })

  // ----------------------------------------------------------
  // Cas bonus : token complètement invalide
  // ----------------------------------------------------------

  it('GIVEN une string aléatoire comme token WHEN decryptQR() THEN throws InvalidQRTokenError', () => {
    expect(() => decryptQR('this-is-not-a-valid-token')).toThrow(InvalidQRTokenError)
  })

  it('GIVEN un token vide WHEN decryptQR() THEN throws InvalidQRTokenError', () => {
    expect(() => decryptQR('')).toThrow(InvalidQRTokenError)
  })

  it('GIVEN un token trop court (< 29 bytes) WHEN decryptQR() THEN throws InvalidQRTokenError', () => {
    // Un token valide fait au moins iv(12) + authTag(16) + ciphertext(1) = 29 bytes
    // = au moins 40 chars base64url
    const shortToken = Buffer.from('short').toString('base64url')
    expect(() => decryptQR(shortToken)).toThrow(InvalidQRTokenError)
  })
})
