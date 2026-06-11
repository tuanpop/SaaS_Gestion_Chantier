/**
 * instrumentation.ts — Next.js 15 server instrumentation hook
 *
 * Ce fichier est exécuté UNE SEULE FOIS au démarrage du serveur Next.js,
 * avant tout Route Handler ou Middleware. C'est le seul endroit correct pour
 * enregistrer des handlers process-level en Next.js App Router.
 *
 * Convention Next.js 15 : export `register` async, fichier à la racine du projet.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Décision : handler uncaughtException + unhandledRejection comme filet de sécurité
 * global. Ne remplace pas la gestion d'erreur fine dans chaque module — complète.
 * Documenté dans DECISIONLOG.md [2026-05-19] Zoro.
 */

export async function register(): Promise<void> {
  // Instrumentation côté serveur uniquement.
  // Next.js peut appeler register() dans le Edge Runtime aussi — on exclut.
  if (process.env['NEXT_RUNTIME'] === 'edge') {
    return
  }

  // Import dynamique pour éviter de bundler logger côté Edge/client.
  // logger.ts est un module pino avec pino-pretty (serverExternalPackages) —
  // safe côté Node.js uniquement.
  const { logger } = await import('@/lib/logger')

  // Enregistrement de la factory LLM (AnthropicClient) — UNE SEULE FOIS au démarrage.
  // Sprint 5 : register.ts a un side-effect d'import qui appelle registerLLMClientFactory().
  // Sans ce chargement, getLLMClient() lève "LLM client not registered" sur cr/generer.
  // Import dynamique : @anthropic-ai/sdk (Node natif) ne doit jamais être bundlé côté Edge.
  await import('@/lib/llm/register')
  logger.info({ llm: 'AnthropicClient' }, 'Factory LLM enregistrée (Sprint 5 Reporting)')

  /**
   * Filet de sécurité : erreur synchrone non catchée hors d'une Promise.
   *
   * Note D-054 : la raison initiale (ioredis TypeError sur socket.auth) est
   * devenue sans objet (lib/redis.ts supprimée). Le handler reste en place
   * comme defense en profondeur générique — tous les modules tiers peuvent
   * potentiellement lever des uncaughtException.
   *
   * Comportement : on logue, on NE crash PAS le process.
   * Justification production : un crash worker = toutes les requêtes en vol
   * reçoivent un 502. Logger + continuer = requête courante échoue proprement,
   * les suivantes continuent de fonctionner.
   *
   * IMPORTANT : ce handler ne doit PAS masquer des bugs applicatifs. Chaque
   * uncaughtException est loggée avec la stack complète — à surveiller dans
   * les logs production (Dokploy → docker service logs).
   */
  process.on('uncaughtException', (err: Error) => {
    logger.error(
      {
        err: err.message,
        stack: err.stack,
        type: 'uncaughtException',
      },
      'Uncaught exception interceptée — process maintenu (filet de sécurité)',
    )
    // Ne pas appeler process.exit() — le worker reste en vie.
    // Docker Swarm restart policy ne se déclenche pas → pas de boucle crash.
  })

  /**
   * Filet de sécurité : Promise rejetée sans .catch() ni await.
   *
   * En Node.js 15+, une unhandledRejection crash le process par défaut.
   * Ce handler remplace le comportement par un log + continuité.
   */
  process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    logger.error(
      {
        reason: message,
        stack,
        type: 'unhandledRejection',
      },
      'Promise rejection non gérée interceptée — process maintenu (filet de sécurité)',
    )
  })

  logger.info(
    { handlers: ['uncaughtException', 'unhandledRejection'] },
    'Process-level error handlers enregistrés',
  )
}
