// lib/llm/prompt.ts — Échappement des délimiteurs XML
// EXI-Y-03 BINDING : neutralise les tentatives de fermeture prématurée des blocs de données
// TST-K5-02 : test obligatoire — voir tests/unit/reporting-llm.test.ts
// F004 Itachi corrigé par Yuki avant cette implémentation

/**
 * Neutralise les occurrences des balises de fermeture XML utilisées comme délimiteurs
 * dans les prompts LLM cr-journalier et rapport-hebdo.
 *
 * Couvre les deux délimiteurs XML utilisés :
 *   - </signaux_terrain>       (cr-journalier)
 *   - </comptes_rendus_semaine> (rapport-hebdo)
 *
 * Un attaquant qui insère `</signaux_terrain>` dans un titre de tâche ou un motif
 * de blocage pourrait fermer prématurément le bloc de données et injecter des
 * instructions hors-balise interprétées par le LLM comme directives.
 *
 * Après échappement, la séquence devient `<\/signaux_terrain>` — le LLM voit
 * toujours le texte mais ne peut plus interpréter la balise comme fermeture de bloc.
 *
 * TST-K5-02 : après escapeDelimiter, le userMessage final ne contient qu'UNE SEULE
 * occurrence de `</signaux_terrain>` (la vraie, en fin de bloc).
 *
 * @param serialized - Chaîne JSON sérialisée des données à passer au LLM
 * @returns Chaîne avec délimiteurs neutralisés
 */
export function escapeDelimiter(serialized: string): string {
  return serialized
    .replace(/<\/signaux_terrain>/gi, '<\\/signaux_terrain>')
    .replace(/<\/comptes_rendus_semaine>/gi, '<\\/comptes_rendus_semaine>')
}
