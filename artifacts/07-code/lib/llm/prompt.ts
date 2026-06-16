// lib/llm/prompt.ts — Échappement des délimiteurs XML
// EXI-Y-03 BINDING : neutralise les tentatives de fermeture prématurée des blocs de données
// TST-K5-02 : test obligatoire — voir tests/unit/reporting-llm.test.ts
// F004 Itachi corrigé par Yuki avant cette implémentation
// Sprint 8 EXI-Y-K8-01 BINDING : extension pour couvrir </message> et </data>
//   (délimiteurs utilisés dans les prompts chat/bot pipeline Sprint 8)
//   Rétrocompatible : les appels Sprint 5/6/7 non affectés (extension additive).
//   R4 plan : escapeDelimiter doit couvrir </message> et </data> en plus des délimiteurs existants.

/**
 * Neutralise les occurrences des balises de fermeture XML utilisées comme délimiteurs
 * dans les prompts LLM.
 *
 * Couvre les délimiteurs XML utilisés (Sprint 5/6/7 + Sprint 8) :
 *   - </signaux_terrain>        (cr-journalier Sprint 5/6)
 *   - </comptes_rendus_semaine> (rapport-hebdo Sprint 5/6)
 *   - </message>                (chat/bot pipeline Sprint 8 — EXI-Y-K8-01)
 *   - </data>                   (chat/bot pipeline Sprint 8 — EXI-Y-K8-01)
 *
 * Un attaquant qui insère `</message>` dans un message de chat pourrait fermer
 * prématurément le bloc <message>...</message> et injecter des instructions
 * hors-balise interprétées par le LLM comme directives.
 *
 * Après échappement, la séquence devient `<\/message>` — le LLM voit
 * toujours le texte mais ne peut plus interpréter la balise comme fermeture de bloc.
 *
 * TST-K5-02 : après escapeDelimiter, le userMessage final ne contient qu'UNE SEULE
 * occurrence de `</signaux_terrain>` (la vraie, en fin de bloc).
 *
 * @param serialized - Chaîne à passer au LLM (message brut ou données sérialisées)
 * @returns Chaîne avec tous les délimiteurs neutralisés
 */
export function escapeDelimiter(serialized: string): string {
  return serialized
    .replace(/<\/signaux_terrain>/gi, '<\\/signaux_terrain>')
    .replace(/<\/comptes_rendus_semaine>/gi, '<\\/comptes_rendus_semaine>')
    // Sprint 8 EXI-Y-K8-01 : délimiteurs chat/bot pipeline
    .replace(/<\/message>/gi, '<\\/message>')
    .replace(/<\/data>/gi, '<\\/data>')
}
