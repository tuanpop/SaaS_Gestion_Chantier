// lib/reporting/filename.ts — Assainissement nom de fichier PDF
// RG-PDF-003 : [^a-zA-Z0-9-_] → '-', max 50 chars, élimine CR/LF/guillemets
// TST-K5-18 : test obligatoire — voir tests/unit/reporting-pdf-filename.test.ts
// SURF-5-10 Kakashi : protection header injection via Content-Disposition

/**
 * Assainit une chaîne pour usage dans un nom de fichier PDF (Content-Disposition).
 *
 * Transformations appliquées (dans l'ordre) :
 *  1. Supprime les CR (\r), LF (\n) et tabulations — protection header injection
 *  2. Supprime les guillemets simples et doubles — protection header injection
 *  3. Remplace tout caractère non alphanumérique/tiret/underscore par '-'
 *  4. Réduit les suites de tirets multiples à un seul tiret
 *  5. Supprime les tirets en début et fin de chaîne
 *  6. Tronque à maxLen caractères (défaut 50)
 *  7. Si vide après traitement, retourne 'document'
 *
 * @param name - Nom brut (ex: nom de chantier, date)
 * @param maxLen - Longueur max (défaut 50, max 100 selon RG-PDF-003)
 * @returns Nom assaini, sûr pour Content-Disposition filename
 */
export function sanitizeFilename(name: string, maxLen = 50): string {
  let safe = name
    // 1. Supprime CR, LF, tabulations (header injection)
    .replace(/[\r\n\t]/g, '')
    // 2. Supprime guillemets (header injection via Content-Disposition: attachment; filename="X")
    .replace(/['"]/g, '')
    // 3. Remplace tout caractère non alphanumérique/tiret/underscore par '-'
    .replace(/[^a-zA-Z0-9\-_]/g, '-')
    // 4. Réduit les suites de tirets multiples à un seul tiret
    .replace(/-{2,}/g, '-')
    // 5. Supprime les tirets en début et fin
    .replace(/^-+|-+$/g, '')

  // 6. Tronque
  safe = safe.substring(0, Math.min(maxLen, 100))

  // 5 bis. Après troncature, peut se retrouver avec un tiret en fin
  safe = safe.replace(/-+$/, '')

  // 7. Fallback si vide
  return safe.length > 0 ? safe : 'document'
}

/**
 * Construit le nom de fichier PDF d'un CR journalier.
 * Format : CR-[chantier]-[date].pdf
 * Ex: CR-Renovation-Leclerc-2026-06-10.pdf
 */
export function buildCrFilename(chantierNom: string, dateCr: string): string {
  const chantierSafe = sanitizeFilename(chantierNom, 40)
  const dateSafe = sanitizeFilename(dateCr, 10)
  return `CR-${chantierSafe}-${dateSafe}.pdf`
}

/**
 * Construit le nom de fichier PDF d'un rapport hebdo.
 * Format : RapportHebdo-[chantier]-S[N]-[AAAA].pdf
 * Ex: RapportHebdo-Renovation-Leclerc-S24-2026.pdf
 */
export function buildHebdoFilename(
  chantierNom: string,
  anneeIso: number,
  semaineIso: number,
): string {
  const chantierSafe = sanitizeFilename(chantierNom, 36)
  return `RapportHebdo-${chantierSafe}-S${semaineIso}-${anneeIso}.pdf`
}
