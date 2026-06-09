// tests/unit/taches-no-deleted-at.test.ts
// Garde-fou régression (smoke prod 2026-06-09) :
//   POST /api/photos plantait avec 42703 "column taches.deleted_at does not exist".
// La table `taches` est en HARD delete (CASCADE migration 002) — elle n'a PAS de colonne
// `deleted_at`. La dette D-045 (Sprint 2) avait ajouté à tort des filtres `.is('deleted_at', null)`
// sur des requêtes `taches` dans plusieurs handlers ; certains corrigés, `photos` oublié.
//
// Ce test scanne tous les Route Handlers et échoue si une chaîne `.from('taches')` contient
// un filtre `.is('deleted_at')` / `.eq('deleted_at')`. Les filtres sur `users` (qui a un vrai
// soft-delete) ne sont PAS concernés.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findRouteFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('Régression : aucune requête sur `taches` ne filtre `deleted_at` (colonne inexistante)', () => {
  it('aucun handler /api ne chaîne .is/.eq("deleted_at") sur un .from("taches")', () => {
    const apiDir = join(process.cwd(), 'app', 'api')
    const files = findRouteFiles(apiDir)
    const violations: string[] = []

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      // Découpe sur chaque `.from(` ; un segment qui commence par 'taches' est une requête taches.
      const parts = src.split(/\.from\(/)
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i]!.trimStart()
        if (!/^['"]taches['"]/.test(part)) continue
        // Isole la chaîne jusqu'au terminateur de requête (single/insert/update/...).
        const chain = part.split(/\.(single|maybeSingle|insert|update|upsert|delete|then)\(/)[0] ?? part
        if (/\.(is|eq)\(\s*['"]deleted_at['"]/.test(chain)) {
          violations.push(file.replace(process.cwd(), ''))
        }
      }
    }

    expect(violations, `taches n'a pas de colonne deleted_at — fichiers fautifs : ${violations.join(', ')}`).toEqual([])
  })
})
