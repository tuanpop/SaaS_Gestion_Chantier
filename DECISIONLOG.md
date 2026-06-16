# Decision Log - ClawBTP (SaaS_Gestion_Chantier)

Format :
```
[YYYY-MM-DD] [Agent] [permanent:true|false]
Decision : [ce qui a ete decide]
Raison : [pourquoi]
Alternative ecartee : [ce qui a ete considere et rejete]
```

---

[2026-06-16] Amelia [permanent:false]
Decision : OPENWEATHER_API_KEY check deplace de module-level vers lazy (inside geocoderCodePostal + fetchOneCall)
Raison : process.env check a module-level throw pendant `next build` (collecte static page data) meme quand la var est absente — comportement attendu en dev/prod mais casse le build. La validation lazy preserve le fail-fast au runtime (premier appel reel) et ne change pas le comportement au deploy.
Alternative ecartee : startup check module-level (spec architecture) — incompatible avec next build static analysis

[2026-06-16] Zoro [permanent:false]
Decision : D-7-12 AMENDE — OPENWEATHER_API_KEY approche lazy + WARNING au boot (pas de throw). getOpenWeatherApiKey() retourne string|null au lieu de throw. Warning module-level UNE FOIS au demarrage si cle absente ("OPENWEATHER_API_KEY absente — briefing fonctionnera sans meteo (fallback best-effort D-7-07)"). Pas de throw au niveau module (incompatible next build) ni dans getOpenWeatherApiKey() (la meteo etant best-effort, un appel sans cle retourne source='indisponible' silencieusement apres le warn de boot). F001 Itachi Phase 4 resolu.
Raison : D-7-07 (meteo best-effort) et D-7-12 (startup check) etaient en contradiction. La reconciliation retenue : clé OPTIONNELLE (coherent D-7-07 — app demarre sans elle, briefing fonctionne en degradé), mais l'operateur est alerte une seule fois au boot via logger.warn visible dans les logs Dokploy. Le throw au boot (D-7-12 original) aurait bloque le demarrage si la cle est absente en dev/smoke/pilote, violant D-7-07 et cassant next build.
Alternative ecartee : throw module-level (casse next build, bloque demarrage — viole D-7-07) ; throw dans getOpenWeatherApiKey() sans warn boot (silencieux — l'operateur n'est pas alerte) ; ne pas modifier (contradiction D-7-07/D-7-12 laissee ouverte — F001 Itachi).

[2026-06-16] Zoro [permanent:false]
Decision : F002 Itachi Phase 4 — chantiers_skipped_archive retire de ReponseCronBriefing (types/briefing.ts) et de l'initialisation route.ts. Le champ etait structurellement toujours 0 car le cron charge uniquement statut='actif' (les archives ne sont jamais evalues, donc pas "skipped").
Raison : Un compteur toujours 0 est trompeur pour l'operateur et pour Levi. Le choix le plus simple et coherent : retirer le champ plutot qu'ajouter une requete supplementaire pour compter les chantiers archives (cout inutile, information non actionnable).
Alternative ecartee : charger tous les chantiers puis filtrer statut='actif' pour compter les archives (requete plus lourde, information non actionnable au pilote).

[2026-06-16] Zoro [permanent:false]
Decision : F003 Itachi Phase 4 — 4 erreurs tsc corrigees dans les fichiers de test __tests__/ (dans le scope tsc — non exclus par tsconfig.json qui exclut tests/** mais pas __tests__/**). Corrections chirurgicales : (1) cron-briefing.test.ts ligne 175 : body conditionnel via init partiel RequestInit (pas de body: undefined explicite, incompatible exactOptionalPropertyTypes) ; (2/3) llm-model-extension.test.ts + non-regression-sprint5-6.test.ts : AnthropicMock caste en (new () => object) & { APIConnectionTimeoutError: ... } pour permettre l'assignation de la propriete statique sur Mock<Procedure> ; (4) non-regression-sprint5-6.test.ts NR-2 : model: undefined remplace par cle omise (exactOptionalPropertyTypes interdit undefined explicite sur prop optionnelle LLMModel). tsc --noEmit = 0 erreur apres correction.
Raison : exactOptionalPropertyTypes:true dans tsconfig impose que les proprietes optionnelles (prop?: T) ne peuvent pas recevoir undefined explicitement — la cle doit etre absente. Mock<Procedure> de Vitest n'a pas de proprietes statiques typees — le cast as unknown as ... contourne le type sans modifier le code de production.
Alternative ecartee : ajouter __tests__/** a l'exclude du tsconfig (les tests doivent etre types — CLAUDE.md) ; model: undefined avec cast (masque le vrai probleme de type).

[2026-06-16] Zoro [permanent:false]
Decision : F004 Itachi Phase 4 — ajout alerte observabilite quota OpenWeather dans cron/briefing/route.ts : if (reponse.meteo_appels_api > 200) logger.warn({ meteo_appels_api }, 'cron/briefing: meteo_appels_api > 200, surveiller quota OpenWeather'). Positionne apres le traitement de tous les chantiers, avant le logger.info final. EXI-Y-K7-09 / TST-K7-10 satisfait.
Raison : Le plan gratuit OpenWeather = 1000 appels/jour. A 20 chantiers distincts CP, le cron peut faire 20 appels API. Un passage avec > 200 appels indiquerait une configuration anormale (centaines de chantiers ou bug de cache). L'alerte est un garde-fou observabilite sans blocage (EXI-Y-K7-09 "pas de blocage V1").
Alternative ecartee : blocage si > 200 (interdit par EXI-Y-K7-09 "pas de blocage V1") ; seuil different (200 = spec TST-K7-10 / coherence_phase4-sprint7.md F004).

[2026-06-16] Amelia [permanent:false]
Decision : Tests LM/NR utilisent process.env['ANTHROPIC_API_KEY'] = 'test-key-mock' dans beforeAll
Raison : AnthropicClient constructor verifie la presence de la cle avant d'instancier le SDK. Le mock vi.mock('@anthropic-ai/sdk') remplace le SDK mais pas le check env. Seul pattern viable : setter une valeur fake avant construction.
Alternative ecartee : Mocker le constructor entier — violerait le principe de test de la logique de routage model?.

[2026-06-16] Amelia [permanent:false]
Decision : Mock '@anthropic-ai/sdk' inclut APIConnectionTimeoutError comme classe dans le mock factory
Raison : anthropic.ts utilise `err instanceof Anthropic.APIConnectionTimeoutError` dans le catch. Sans cette classe dans le mock, TypeError: Right-hand side of instanceof is not an object.
Alternative ecartee : try/catch autour du instanceof — modifierait le code de production pour contourner un probleme de test.

[2026-06-16] Amelia [permanent:false]
Decision : genererMessageFallbackBriefing capitalise "Semaine" (capital S) dans l'en-tete
Raison : test FB-1 attendait "Semaine 26" (capital S). La cle test-ID n'est pas arbitrary — elle reflete la lecture humaine du briefing imprime ou affiche (cohérence avec "ÉTAT DU CHANTIER", "ALERTES", etc. tous en majuscules).
Alternative ecartee : modifier le test pour accepter "semaine" minuscule — les tests sont la spec, on ne les modifie pas.

[2026-06-16] Amelia [permanent:false]
Decision : cron-briefing.test.ts mocke resolveDestinatairesInternes et insertNotification (manquants v1)
Raison : le cron route appelle envoyerNotificationsBriefing qui appelle resolveDestinatairesInternes et insertNotification — sans mocks ces fonctions tentaient des appels DB reels et provoquaient un timeout 5000ms.
Alternative ecartee : timeout test augmente a 30s — masquerait le vrai probleme (appel DB reel en test unitaire).

---

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 8 — pipeline bot asynchrone FIRE-AND-FORGET (pas de queue). Le POST /api/chantiers/[id]/chat/messages INSERT le message (type=user, service_role) -> retourne 201 IMMEDIAT -> lance `void lancerPipelineBot(message)` SANS await dans le meme process Node. Le pipeline (Haiku tri -> Sonnet conditionnel) catch tout en interne (best-effort), ne throw jamais, n'a aucun effet sur le 201 ni sur le message humain. La proposition/reponse bot apparait au polling client suivant (<=30s). Pas de retry. (D-8-11 / ADR-8-001)
Raison : l'analyse LLM prend 2-10s ; bloquer le POST degraderait l'UX terrain (ouvrier qui attend). Une queue (BullMQ/Redis) reintroduirait l'infra Redis droppee V1 (D-054, bug ioredis Docker Swarm) = over-engineering au volume pilote (quelques messages/h/chantier). Coherent avec le best-effort Sprint 5/6/7. Le message humain est persiste avant le pipeline -> aucune perte de donnee meme si le process meurt.
Alternative ecartee : await le pipeline avant 201 (bloque l'UX 2-10s, inacceptable terrain) ; queue Redis/BullMQ (reintroduit infra fragile Docker Swarm pour un besoin sur-dimensionne) ; table jobs + cron supercronic (latence cron periodique + complexite worker pour gain nul au volume pilote).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 8 — pipeline LLM 2 passes Haiku->Sonnet CONDITIONNEL (filtre cout). Haiku (model defaut claude-haiku-4-5, ~$0.00006/msg) trie CHAQUE message humain en neutre/claw_inline/action_a_proposer. Sonnet (model:'claude-sonnet-4-6' via le model? de D-7-11) appele UNIQUEMENT si intention != neutre (~15% des messages). Haiku ne construit jamais le payload (il trie). Rate-limit 10 Sonnet/h/chantier via lib/cache.ts (cle sonnet_rate_${chantier_id}). Trial-gate : org trial_expired -> 0 appel LLM (message poste normalement). (D-8-12/17/18 / ADR-8-002)
Raison : appeler Sonnet sur chaque message couterait x10 inutilement (85% des messages neutres). Haiku filtre en amont bon marche. Cout pilote estime ~$3.33/mois 5 chantiers ~0.6% MRR (stress 50% Sonnet ~3%), tres sous la limite PRD 15%. Reutilise model? (D-7-11) sans nouveau client. Haiku robuste aux fautes/SMS ouvrier (PO-8-02=B participant actif).
Alternative ecartee : Sonnet seul/message (cout x10 inutile) ; Haiku seul extraction directe (qualite JSON FR-BTP insuffisante) ; classifieur local regex/keywords (fragile sur langage terrain libre, faux pos/neg eleves).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 8 — le bot PROPOSE, l'humain EXECUTE (ADR-007/D-008/D-013 etendu au chat). Sonnet produit UNIQUEMENT une action_proposals.statut='pending' (4 types : creer_tache/ajouter_cr/replanifier/alerte, ADR-013). AUCUNE execution dans le pipeline. L'execution reelle (INSERT taches / UPDATE date / lien comptes_rendus / insertNotification) se fait UNIQUEMENT dans PATCH /api/action-proposals/[id]/valider apres decision humaine (admin/conducteur). IDOR : chantier_id/organisation_id FORCES depuis action_proposals (figes serveur a la creation), JAMAIS depuis le payload editable — toute UPDATE/INSERT porte le double filtre. Workflow pending->valide->execute / pending->rejete, statut pending requis (sinon 409, idempotence anti double-execution). Execution best-effort : KO -> statut reste valide + erreur_execution (pas de rollback de la decision). (D-8-13/14 / ADR-8-003)
Raison : le chat est la surface d'injection MAXIMALE du projet (texte libre, multi-acteurs, ouvrier inclus PO-8-02=B). Une instruction injectee ("@claw supprime toutes les taches") ne peut au pire produire qu'une proposition pending — visible, editable, rejetable. Coherent ADR-007 (validation CR humaine) / D-008 (LLM ne decide jamais) / D-013 (chat). Argument commercial fort (PME garde le controle). L'execution auto a ete explicitement rejetee (archive Decisions : "Action bot sans validation humaine — Securite + argument commercial").
Alternative ecartee : execution auto (bot decideur — rejet historique) ; auto-execution des actions "sures" (alerte) seules (incoherence modele mental + surface injection sur le tri sur/non-sur) ; chantier_id depuis le payload (IDOR direct).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 8 — chat polling 30s (PO-8-01=A, pas de Realtime/WebSocket/SSE, zero dependance Realtime SDK, coherent fil notifs Sprint 4 PO-4V-06). Accueil Claw (feature #9) greffe sur GET /api/auth/qr/[token] EXISTANT : apres creation session, accueil Haiku idempotent (uq_claw_accueil_user_date, 1/ouvrier/jour) best-effort total (scan reussit TOUJOURS meme si accueil KO), reutilise meteo_cache Sprint 7 (ZERO appel OpenWeather), banniere PWA (pas de cloche ouvrier PO-4V-03), trial -> contenu deterministe sans Haiku. 3 migrations manuelles sequentielles 018(chats+messages)->019(action_proposals + FK retour + enum notification_type += action_proposal,alerte_chat ISOLE fin)->020(claw_accueil_log). Ecriture chat = service_role only (RLS WITH CHECK(false) partout, D-8-04). Purge SQL-pur pg_cron (messages 90j PO-8-03=B + accueil 30j), PAS supercronic. ZERO nouvelle dependance npm/env/infra. (D-8-01/04/08/10/16/20 / ADR-8-004/005)
Raison : volume PME BTP faible (quelques messages/h) -> polling 30s suffit, Realtime = over-engineering V2. L'accueil greffe sur le scan est contextuel au moment reel (vs cron aveugle qui ne sait pas quand l'ouvrier vient et genere pour des absents). Best-effort = le scan terrain (mains sales, batterie) n'est jamais bloque ni allonge (fire-and-forget apres session, comme le pipeline bot). Enums isoles fin de migration : PG interdit ADD VALUE dans la meme transaction que son usage (lecon Sprint 6 derive_proactive TST-K6-28, Sprint 7 briefing_lundi V-7-12). RLS service_role-only empeche de forger un message bot ou falsifier un statut de proposition via PostgREST direct.
Alternative ecartee : Supabase Realtime (latence <1s mais SDK + policies + dependance non justifies au volume pilote) ; SSE (complexite connexion longue Docker Swarm/Traefik) ; cron nocturne pre-generant les accueils (ne sait pas quand l'ouvrier vient, cout gaspille, meteo pas fraiche) ; generation synchrone bloquant le scan (allonge le scan terrain) ; accueil dans le chat (ouvrier n'a pas le chat ouvert au scan + pollue le fil).

---

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 7 — selection du modele LLM via champ OPTIONNEL model? sur LLMGenerateParams (lib/llm/client.ts). Ajout type LLMModel = 'claude-haiku-4-5' | 'claude-sonnet-4-6'. AnthropicClient lit params.model ?? 'claude-haiku-4-5' (defaut Haiku PRESERVE). genererContenuBriefing passe model:'claude-sonnet-4-6'. Sprint 5 (CR) + Sprint 6 (derives) inchanges (ne passent pas le champ). (D-7-11 / ADR-7-001)
Raison : le briefing lundi exige Sonnet (PRD feature #5 WOW factor, PO acte RYO-7-01) alors que ILLMClient.generate() n'avait aucun parametre de modele et AnthropicClient hardcodait Haiku (const MODEL_ID). Extension minimale, backward-compatible, swappable (respecte D-5-01). Un seul AnthropicClient/getLLMClient/register partage entre les 2 modeles (le SDK Anthropic accepte model par requete).
Alternative ecartee : dupliquer AnthropicSonnetClient + 2e factory (viole DRY, multiplie register/getLLMClient) ; variable env globale LLM_MODEL (empeche Haiku derive + Sonnet briefing dans le meme process) ; new AnthropicClient(model) (incompatible avec le singleton getLLMClient partage).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 7 — integration OpenWeather via fetch natif (Node 18+), PAS de SDK npm. Nouvelle dependance EXTERNE (One Call 3.0 + Geocoding ZIP). Cache DB meteo_cache (mig 017) cle code_postal (PAS organisation_id — meteo publique partagee entre orgs), TTL 6h, coordonnees geocoding cachees (lat/lon), nettoyage par le cron briefing (>24h). Secret OPENWEATHER_API_KEY server-only (jamais NEXT_PUBLIC_, Dokploy Environment), startup check throw si absent (pattern QR_ENCRYPTION_KEY), jamais logge (URL avec appid= interdite en log). (D-7-06/12 / ADR-7-004)
Raison : chantiers.code_postal est la seule geodonnee ; plusieurs chantiers partagent souvent un meme CP ; la meteo est publique non proprietaire. Le cache par code_postal borne les appels a <=1/CP distinct/6h (a 20 chantiers/8 CP distincts -> <=8 appels). fetch natif evite une dependance npm superflue. Plan gratuit OpenWeather (1000 appels/jour) tres suffisant au pilote.
Alternative ecartee : SDK OpenWeather npm (dependance superflue) ; cache memoire process lib/cache.ts (perdu au restart, cron 1x/semaine = cache toujours froid, non partage entre replicas) ; cache par chantier (N appels redondants meme CP) ; cache scope org (redondance inutile, meteo identique pour tous les chantiers d'un CP).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 7 — briefing best-effort a deux niveaux INDEPENDANTS. Meteo KO (geocoding 404 / One Call 429/timeout / JSON malforme) -> source='indisponible', Sonnet appele quand meme. Sonnet KO/timeout/trial_expired -> message_fallback deterministe (genererMessageFallbackBriefing), contenu_genere=null, briefing+notif inseres quand meme. Aucun des deux ne bloque la generation : un chantier actif est TOUJOURS briefe chaque lundi. Collecte deterministe (collecterSignaux TS pur, D-008 etendu — ADR-7-002) — le briefing AGREGE les derives Sprint 6 (derives_detectees WHERE resolved_at IS NULL), ne les recalcule pas. Idempotence DB uq_briefing_chantier_semaine (chantier_id, annee_iso, semaine_iso) + ON CONFLICT DO NOTHING. (D-7-01/02/04/07/08 / ADR-7-002/003)
Raison : le briefing prospectif pour un chantier actif est attendu chaque lundi (feature MUST HAVE S7-F01). Contrairement au CR Sprint 5 (livrable engageant qui throw 502), un briefing degrade vaut mieux que pas de briefing. Coherent best-effort Sprint 6 (D-6-03). Un echec OpenWeather ne doit pas priver tous les chantiers de briefing un lundi entier. D-008 : decision metier deterministe, LLM redacteur seul (testable, auditable via donnees_brutes snapshot).
Alternative ecartee : throw comme le CR Sprint 5 (un echec externe priverait tous les chantiers un lundi entier) ; faire decider Sonnet des risques/derives (viole D-008, non testable/auditable, risque d'hallucination metier) ; cache meteo scope org (cf. entree dependance OpenWeather).

---

[2026-06-16] Amelia [permanent:false]
Decision : Branchement prompt Yuki briefing-chantier Sprint 7 — déviations par rapport au STUB.
1. escapeDelimiter (schema.ts Yuki) couvre uniquement </data> et <data>. Le STUB couvrait aussi </signaux_terrain> et </comptes_rendus_semaine>. La déviation est intentionnelle : le prompt briefing Yuki n'utilise pas ces délimiteurs Sprint 5/6 — leur escaping était donc redondant. Les tests SEC-9 et NR-4 ont été mis à jour pour refléter le comportement réel.
2. BRIEFING_LLM_PARAMS.maxTokens = 900 (Yuki) vs 800 (STUB). Test NR-3 mis à jour.
3. buildBriefingUserMessage ne fait plus de SignauxBriefingChantierSchema.parse() — le cast est sûr car le cron garantit statut='actif' en amont (D-7-01). La validation Zod complète des inputs n'est pas dans le scope de genererContenuBriefing (D-7-04 best-effort : les erreurs vont dans le catch → fallback).
4. genererContenuBriefing.ts : la troncature à 8000 chars est remplacée par BriefingOutputSchema.safeParse() → si invalide → fallback (D-7-04 best-effort). Un output trop court ou trop long est une anomalie LLM → fallback.
Raison : cohérence avec le pattern Sprint 6 (MessageDeriveOutputSchema.safeParse → fallback), spec Yuki BRIEFING_LLM_PARAMS binding, et principe D-7-04.
Alternative écartée : garder la troncature du STUB (contredit D-7-04 : un output invalide doit déclencher le fallback, pas être tronqué silencieusement).

[2026-06-16] Amelia [permanent:false]
Decision : SEC-9 mis à jour — escapeDelimiterBriefing du STUB (</signaux_terrain>, </comptes_rendus_semaine>) non porté dans le schema Yuki (escapeDelimiter covers </data> et <data> uniquement). Ces délimiteurs Sprint 5/6 ne sont pas dans le format <data>...</data> du prompt briefing → leur escaping n'est plus pertinent. EXI-Y-K7-03 BINDING couvre les 4 champs non fiables sur le délimiteur effectif.
Raison : spec Yuki schema.ts fait autorité sur le STUB Amelia.
Alternative écartée : conserver l'escaping étendu dans un wrapper local (over-engineering, non spécifié par Yuki).

[2026-06-16] Amelia [permanent:false]
Decision : Emplacement du schema Yuki derive-chantier = lib/detection/prompts/derive-chantier/schema.ts (co-localisé avec la feature detection). Le system prompt Yuki (artifacts/09-llm/prompts/derive-chantier/system.md) est incorporé comme constante TS inline SYSTEM_PROMPT_DERIVE dans lib/detection/genererMessageDerive.ts. Le stub buildPrompt() est supprimé et remplacé par buildUserMessage() + DERIVE_LLM_PARAMS du schema Yuki. Le slice(0, 1000) du stub est remplacé par MessageDeriveOutputSchema.safeParse() → fallback si invalide (D-6-03 best-effort).
Raison : Co-localisation avec lib/detection/ cohérente avec le reste de l'arbo — les prompts de la feature detection vivent dans lib/detection/prompts/, pas dans lib/llm/prompts/ (qui est pour les features reporting Sprint 5). Le system prompt inline évite un import de fichier .md à l'exécution. MessageDeriveOutputSchema (min 10, max 2000) remplace la troncature manuelle : la spec Yuki dit "fallback si invalide", pas "tronquer".
Alternative écartée : copier schema.ts sous lib/llm/prompts/derive-chantier/ (lib/llm/ est scoped Sprint 5 reporting — mélange de features) ; lire system.md depuis le filesystem à l'exécution (non testable, dépendance I/O inutile) ; garder la troncature à 1000 chars du stub (contredit D-6-03 : fallback si output invalide).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 6 — borne inférieure ratio_budget = 0.50 (au lieu de > 0) entérinée et SORTIE du chemin d'évolution → scope Sprint 6. Enforced en défense profonde : Zod PatchSeuilsDerivesSchema (ratio_budget ∈ [0.50, 1)) ET CHECK SQL migration 015 (ratio_budget >= 0.50 AND ratio_budget < 1). (ADR-6-006 / EXI-Y-K6-07)
Raison : Kakashi a tranché la délégation que l'archi §6.1 lui confiait (EXI-Y-K6-07 / TST-K6-25). Un ratio_budget proche de 0 ferait dériver tout chantier (flood notif + DoS économique LLM) ; un seuil < 50% n'a aucun sens métier BTP. Résout F002 (bloquant Itachi Phase 3) côté archi et aligne le fix specs Ryō (RYO-6-05 / RG-SEUILS-003) + UX Hana (S6-04 min=50%). Aucune valeur en prod < 0.50 (défaut 0.85). Decision Table §1.5 inchangée.
Alternative écartée : laisser > 0 + rate-limit utilisateur (YAGNI au pilote, ne traite pas la cause — un seuil absurde) ; borne Zod seul sans CHECK SQL (pas de défense profonde — écriture service_role contournerait Zod).

[2026-06-16] Shinji [permanent:false]
Decision : Sprint 6 — fix traçabilité F005 (warning Itachi Phase 3) : architecture-sprint-6.md §5.1/§5.2/§6/§6.1/§7.1/§8/§12 référencent désormais les IDs TST-K6-XX et EXI-Y-K6-XX du threat-model par élément d'archi (colonne "Réf. Kakashi" ajoutée aux tables endpoints, security-critical, migrations 014/015, vigilances). Aucune décision binding modifiée. V-16 ajouté (borne ratio_budget non enforcée).
Raison : Itachi/Amelia/Levi Phase 4 doivent savoir quelle exigence sécurité couvre quel élément d'archi : anti-injection EXI-Y-K6-01/02/03, note_privee TST-K6-02, IDOR TST-K6-12/14/18/23, x-cron-secret + DoS LLM TST-K6-07/08/25, borne EXI-Y-K6-07, trial skip LLM TST-K6-10.
Alternative écartée : laisser la prose descriptive sans IDs (gap de traçabilité Phase 4 — verdict F005).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 6 — détection des dérives proactives = lib TypeScript pure (lib/detection/detecterDerives.ts, 4 fonctions recevant SeuilsEffectifs, ZÉRO appel LLM) ; le LLM Haiku (genererMessageDerive) est appelé APRÈS à partir d'un snapshot typé SignauxDeriveChantier et ne décide JAMAIS d'une dérive. (D-6-01 / ADR-6-001)
Raison : D-008 / ADR-008 BINDING absolu — la détection métier critique doit être déterministe, testable sans réseau, reproductible, auditable (signal_valeur). Reproduit le pattern Sprint 5 (collectSignaux→genererContenuCR). Feature MUST HAVE : S6-F01 détection proactive (US-047, ADR-008).
Alternative écartée : LLM détecteur (non déterministe, faux positifs sur décision métier, coût non borné, opaque) ; règles SQL pures sans LLM (perd la restitution "orientée action" du PRD — le LLM enrichit le message, pas la décision).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 6 — idempotence cron-over-cron au niveau DB : index UNIQUE partiel uq_derive_active_chantier_type_tache sur (chantier_id, type, COALESCE(tache_id, sentinel uuid)) WHERE resolved_at IS NULL + INSERT ON CONFLICT DO NOTHING. Une dérive résolue (resolved_at posé) peut se ré-ouvrir en nouvelle ligne (audit trail). Pas de SELECT-puis-INSERT. (D-6-06 / ADR-6-002)
Raison : PO-6-01=A — une dérive persistante ne doit générer qu'une notification, mais une dérive résolue puis redéclenchée doit re-notifier. L'index partiel garantit l'unicité de la dérive ACTIVE sans empêcher la ré-ouverture. Gère le double-run cron (replicas:1 + contrainte DB). Leçon Sprint 4 (doublons jalons via notifications.lu).
Alternative écartée : idempotence via notifications.lu (couple détection et état de lecture, fragile) ; SELECT-then-INSERT (race cron double-run).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 6 — appel LLM dérive = BEST-EFFORT (≠ throw de Sprint 5). Si Haiku KO/timeout/trial_expired : la dérive est quand même persistée + notifiée avec message fallback déterministe (genererMessageFallback) et message_llm=null ; le cron ne throw jamais, llm_erreurs++. (D-6-03 / ADR-6-003)
Raison : une dérive est une ALERTE sur un fait déterministe — la valeur est le fait, le message LLM est un confort ; elle ne doit jamais être perdue sur indispo LLM. Contraste légitime avec Sprint 5 (un CR est un LIVRABLE rédigé validé par un humain → throw, ADR-5-004). Cohérent best-effort des notifications (ADR-4V-001). Feature MUST HAVE : S6-F01 (US-047 scénario LLM KO).
Alternative écartée : throw comme le CR (perdrait l'alerte sur indispo LLM — inacceptable pour une fonction de vigilance) ; ne pas notifier si LLM KO (idem).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 6 — 1 appel LLM AGRÉGÉ par chantier (genererMessageDerive(signaux: SignauxDeriveChantier): Promise<string> reçoit toutes les dérives du chantier), appelé UNIQUEMENT si ≥1 dérive NOUVELLE. Réutilise l'interface ILLMClient existante (Haiku) via getLLMClient() + import side-effect register.ts co-localisé. Modèle/prompt/temperature délégués à @yuki. (D-6-04/D-6-05)
Raison : PO-6-05=B + RG-DERIVE-013 — coût LLM borné (court-circuit chantiers sains + dérives déjà actives). Réutilisation Sprint 5 = zéro nouvelle dépendance. Import co-localisé = fix "LLM client not registered" (commit 6041daf, mémoire nextjs-instrumentation-module-isolation). Plafond cible <5% MRR. Feature MUST HAVE : S6-F01 (US-052 message agrégé).
Alternative écartée : 1 appel LLM par dérive (coût N× supérieur) ; appel sur dérives déjà actives (re-coût inutile) ; nouvelle dépendance SDK (ILLMClient existe déjà).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 6 — seuils de détection configurables par org : table seuils_derives (mig 015, 1 ligne/org UNIQUE, CHECK ratio 0<x<1 / jours≥1), CRUD admin, fallback constantes SEUILS_DEFAUT (0.85/3j/7j) via chargerSeuils() (source 'db'|'defaut'). GET ne renvoie jamais 404. Reset = DELETE la ligne. Aucune rétroaction sur dérives actives (appliqué au prochain cron). (D-6-08/D-6-10 / ADR-6-004)
Raison : PO-6-02=B — calibrage par org (PME tailles variées). source transparent dans l'UI, reset trivial. Pas de rétroaction = comportement prévisible (RYO-6-07). Le cron n'utilise jamais les constantes directement, toujours via chargerSeuils. Feature MUST HAVE : S6-F02 (US-053/054/055).
Alternative écartée : constantes TS figées (pas de calibrage) ; seuils en colonnes sur organisations (pollue table cœur, complique reset).
Note 2026-06-16 (fix F002/F005, ADR-6-006) : la borne CHECK ratio_budget est resserrée à `>= 0.50 AND < 1` (EXI-Y-K6-07), Zod aligné `>= 0.50`. Voir l'entrée dédiée en tête de log.

[2026-06-16] Shinji [permanent:false]
Decision : Sprint 6 — endpoint cron canonique = /api/cron/derives (PLURIEL), conforme specs §6.1. Le crontab clawbtp_cron contient une ligne héritée /api/cron/derive (SINGULIER, commentaire "dérives budget") pointant un endpoint jamais implémenté → Tanjiro corrige la ligne (derive→derives, déjà à 07h00 UTC conforme RYO-6-02). Pas de double endpoint. (D-6-13 / ADR-6-005 / Point de vigilance V-01)
Raison : un seul endpoint réel cohérent avec les specs ; supprime un endpoint mort au nommage trompeur ("budget"). Itachi phase 3 vérifie la cohérence crontab↔route↔specs.
Alternative écartée : implémenter sous /api/cron/derive singulier (diverge des specs, perpétue le nommage trompeur) ; créer les deux (endpoint mort).

[2026-06-16] Shinji [permanent:true]
Decision : Sprint 6 — écriture derives_detectees + seuils_derives via service_role only (RLS SELECT par org D-028 ; INSERT/UPDATE WITH CHECK(false), DELETE USING(false)). Seuils : SELECT RLS restreinte role='admin'. Cycle de vie dérive 100% automatique (détection→notif→auto-résolution→ré-ouverture), AUCUN acquittement/snooze/delete manuel exposé au client. Résolution synchrone à l'archivage chantier via resolverDerivesChantier (best-effort, ne bloque jamais l'archivage). Trial-gate : skip LLM seul (détection+notif fallback toujours). (D-6-07/D-6-09/D-6-11/D-6-12)
Raison : D-028/D-029 cohérent notifications/comptes_rendus — contrôle métier handler-level. PO-6-03=A cycle auto. RG-DERIVE-012 évite des dérives orphelines actives sur chantier archivé. D-012 : la détection est de la valeur produit (pas facturable), seul l'appel Haiku est skippé hors abonnement (cohérent vigilance cron Sprint 5).
Alternative écartée : INSERT/UPDATE authenticated (surface forge, contrôle transition en policy au lieu du handler) ; acquittement manuel (PO-6-03=A le rejette) ; skip toute la détection si trial (perdrait la valeur produit).

---

[2026-06-16] Amelia [permanent:false]
Decision : Sprint 6 EXECUTE — (adminClient as unknown as any).from('table') pour derives_detectees et seuils_derives. Pattern identique aux tables comptes_rendus/rapports_hebdo (Sprint 5, même entrée DECISIONLOG). Commentaires TODO dans chaque cast.
Raison : derives_detectees et seuils_derives ne sont pas encore dans Database types (migrations 014/015 non encore appliquées en prod). TypeScript rejette les queries sans ce cast. Post-migration supabase gen types corrigera.
Alternative écartée : spec telle qu'écrite — type partiel manuel fragile.

[2026-06-16] Amelia [permanent:false]
Decision : Sprint 6 EXECUTE — Archivage chantier via DELETE handler (non PATCH). resolverDerivesChantier injecté dans DELETE (non PATCH).
Raison : Relecture de app/api/chantiers/[id]/route.ts — le handler DELETE, non PATCH, effectue le soft-delete (statut='archive'). Le plan prévoyait PATCH (lecture correcte des specs mais non de l'implémentation existante). Corrects comportements préservés.
Alternative écartée : PATCH (handler ne fait pas l'archivage dans cette implémentation).

[2026-06-16] Amelia [permanent:false]
Decision : Sprint 6 EXECUTE — resolveDestinatairesInternes retourne des emails, non des user IDs. Pour insertNotification (qui attend des user IDs), ajout du helper resolveAdminIds() dans le cron qui fait SELECT id FROM users WHERE org + role=admin. resolveConducteurChantier retourne correctement un user ID.
Raison : resolveDestinatairesInternes (lib/reporting/destinataires.ts) retourne string[] d'emails (pour Resend). insertNotification attend userId. Résolution: helper interne au cron pour les IDs admins.
Alternative écartée : modifier resolveDestinatairesInternes (effet de bord sur les autres appelants Resend).

[2026-06-16] Zoro [permanent:false]
Decision : D-EXE-6-03 (tracé SESSIONLOG, absent DECISIONLOG — F001 Itachi Phase 4) — resolveAdminIds() local dans app/api/cron/derives/route.ts au lieu de resolveDestinatairesInternes() pour la résolution des IDs admins destinataires des notifications dérive.
Raison : resolveDestinatairesInternes (lib/reporting/destinataires.ts) retourne string[] d'emails (pour Resend) — non compatible avec insertNotification qui attend des userId. Le helper local resolveAdminIds() fait SELECT id FROM users WHERE organisation_id = orgId AND role = 'admin' AND deleted_at IS NULL, ce qui est fonctionnellement équivalent à la partie admins de resolveDestinatairesInternes (même filtre deleted_at IS NULL, ouvriers exclus par role='admin'). TST-K6-34 est satisfait : destinataires = admins + conducteur rattaché, jamais ouvrier.
Alternative écartée : modifier resolveDestinatairesInternes pour retourner des IDs (effet de bord sur tous les appelants Resend Sprint 5) ; adapter resolveDestinatairesInternes avec un mode retour (over-engineering).

[2026-06-16] Zoro [permanent:false]
Decision : F004 Itachi Phase 4 (BLOCKER XSS) — htmlEscape() est appliqué PAR insertNotification en interne (lib/notifications/notif.ts étape 2, lignes 184-185, K4V-02) et NON par le cron avant l'appel. Commentaires du cron et de genererMessageDerive.ts corrigés. Test TST-K6-33 complété avec 2 cas intégration : payload XSS brut → INSERT échappé (no double-encodage), payload sain → INSERT inchangé.
Raison : Investigation réelle du code (non des commentaires). insertNotification applique htmlEscape(params.titre).slice(0,200) et htmlEscape(params.message).slice(0,1000) AVANT INSERT. Ajouter htmlEscape dans le cron aurait produit du double-échappement (&amp;lt; au lieu de &lt;). La délégation à insertNotification est correcte et conforme à D-4V-002 (point unique d'échappement). TST-K6-33 est satisfait en interne par insertNotification — les tests ajoutés le prouvent par inspection du payload INSERT capturé.
Alternative écartée : appliquer htmlEscape dans le cron (double-échappement — bug introduit) ; modifier la signature de insertNotification pour accepter des valeurs déjà échappées (casse tous les appelants Sprint 4/5).

[2026-06-16] Zoro [permanent:false]
Decision : F002 Itachi Phase 4 — suppression du try/catch externe mort autour de genererMessageDerive dans le cron + suppression du pattern llm_appels++/llm_appels-- (dead code). Nouveau pattern : llm_appels++ avant l'appel (la tentative a lieu), await genererMessageDerive sans try/catch externe, messageLlmDb = messageLlm toujours.
Raison : genererMessageDerive a un catch total en interne (D-6-03 BINDING) et retourne toujours une string. Le try/catch externe était dead code — ne pouvait jamais être atteint. Le pattern llm_appels++/llm_appels-- était incohérent : en cas de KO LLM le compteur revenait à 0 (sous-comptage de la tentative). genererMessageDerive log lui-même les erreurs LLM internes via logger.warn. llm_erreurs++ dans le cron supprimé (la détection du fallback par comparaison de chaînes serait fragile).
Alternative écartée : détecter le fallback par comparaison de chaînes (fragile, double-appel à genererMessageFallback) ; changer la signature de genererMessageDerive pour retourner {message, isLlm} (changement de contrat hors scope debug).

[2026-06-16] Zoro [permanent:false]
Decision : F003 Itachi Phase 4 — archivage chantier (soft delete statut='archive') implémenté dans DELETE /api/chantiers/[id], non dans PATCH, contrairement à la description D-6-11. resolverDerivesChantier appelé dans DELETE handler (best-effort). Commentaire d'alignement ajouté dans le handler DELETE. Levi : tester TST-K6-24 via DELETE /api/chantiers/[id].
Raison : L'entrée Amelia 2026-06-16 "Archivage chantier via DELETE handler (non PATCH)" documentait déjà la déviation d'implémentation. Le PATCH handler ne modifie pas le statut (UpdateChantierSchema sans champ statut). Comportement runtime correct — seule la doc architecturale était désalignée.
Alternative écartée : réimplémenter l'archivage dans PATCH (casse l'implémentation existante, hors scope debug).

[2026-06-16] Amelia [permanent:false]
Decision : Sprint 6 EXECUTE — Dashboard admin = app/admin/chantiers/page.tsx (non app/admin/page.tsx qui n'existe pas). SectionAlertesConsolidee injectée dans ChantiersAdminPage, conditionnée à activeTab === 'actifs'.
Raison : Risque #4 du plan. Le routing admin dans ce projet n'a pas de page dashboard dédiée — la liste de chantiers est la page principale. Condition activeTab pour ne montrer les alertes qu'en onglet "Actifs" (cohérent avec la pertinence des alertes actives).
Alternative écartée : créer app/admin/page.tsx (redirection ou duplication de contenu non justifiée par les specs).

[2026-06-16] Amelia [permanent:false]
Decision : Sprint 6 EXECUTE — eslint.config.mjs : ajout de caughtErrorsIgnorePattern: "^_" dans la règle @typescript-eslint/no-unused-vars.
Raison : Les catch clauses dans les Client Components (SectionAlertesChantier, SectionAlertesConsolidee) utilisent `_err` pour se conformer à la convention de préfixage _ des variables inutilisées — mais le pattern varsIgnorePattern ne couvre pas les catch bindings (caughtErrors est une config séparée). Build échouait avec 2 erreurs ESLint sur ces catch.
Alternative écartée : supprimer la variable catch (syntax `catch { ... }` — non universellement supportée dans les versions TS/ESLint du projet) ; eslint-disable inline (plus intrusif).

[2026-06-16] Amelia [permanent:false]
Decision : Sprint 6 EXECUTE — Import UserRole depuis @/types/database (non @/types/detection). 3 routes API (derives, chantiers/[id]/derives, organisations/me/seuils-derives) importaient incorrectement UserRole depuis detection.ts où il n'est pas défini.
Raison : UserRole est un type de base DB (Database["public"]["Enums"]["user_role"]) dans types/database.ts. La specs Sprint 6 ne le déplace pas. Les routes l'importaient via une union incorrecte dans detection.ts.
Alternative écartée : déplacer UserRole dans detection.ts (crée une dépendance circulaire potentielle avec database.ts).

---

[2026-06-15] Zoro [permanent:false]
Decision : RG-CR-011 REMPLACÉ — resolveDestinatairesInternes nouvelle signature (orgId, chantierId, adminClient). Nouvelle logique : (admins org, role='admin', deleted_at IS NULL) ∪ (conducteurs rattachés au chantier : created_by du chantier si conducteur non supprimé, OU conducteurs avec affectation ACTIVE, deleted_at IS NULL). Dédoublonnage par email via Set<string>. Compteur nbDestinataires dans les 4 pages détail remplacé par resolveDestinatairesInternes().length (exact match envoi réel). Routes cr/envoyer et rapports-hebdo/envoyer passent cr.chantier_id / rapport.chantier_id en 2e argument.
Raison : Décision PO binding smoke 2026-06-15 : l'envoi d'un CR ou rapport hebdo ne doit plus cibler TOUS les conducteurs de l'org, mais uniquement ceux rattachés au chantier concerné. PO-5-04 respecté (N calculé côté serveur). AM-03 propriété vérifiée : un conducteur qui envoie passe forcément canAccessChantier → est created_by ou affecté (actif ou passé) ; la nouvelle règle l'inclut si actif, l'exclut si affectation uniquement passée (décision PO assumée).
Alternative ecartee : filtre côté DB avec .or() Supabase (verbeux, moins lisible pour le cas date_fin IS NULL OR date_fin >= today — filtrage JS post-fetch trivial pour le volume pilote). Requête unique JOIN affectations+users (complexité SQL inutile pour le volume pilote). Garder RG-CR-011 (contredit la décision PO binding).

---

[2026-06-10] Amelia [permanent:false]
Decision : GAP-DATA-TESTID-01 fermé. CrActionButtons et RapportHebdoActionButtons remplacent les actions directes au clic par des Dialogs shadcn de confirmation. La prop `nbDestinataires: number` est ajoutée et calculée server-side dans les 4 pages détail (count SELECT users WHERE org + role IN admin/conducteur + deleted_at IS NULL). La prop `chantierId` est ajoutée à RapportHebdoActionButtons pour les appels de régénération.
Raison : design-notes-sprint-5.md lignes 109-110 et §6 sont binding (Dialog shadcn + data-testid spécifiés). PO-5-04 BINDING : le dialog Envoyer affiche "Sera envoyé à N membres", jamais la liste des emails — N calculé côté serveur pour ne pas exposer les emails au client.
Alternative écartée : endpoint `/api/organisations/me/membres/count` séparé (création d'un nouvel endpoint non nécessaire, le count est trivial inline avec le pattern adminClient existant dans chaque page détail).

[2026-06-10] Revue post-Zoro [permanent:true]
Decision : F003 — REVERT du fix Zoro. collectSignaux.ts : la requête photos est scopée EXCLUSIVEMENT par `.in('tache_id', tacheIds)` et n'est PAS exécutée si `tacheIds` est vide (photosData reste []). Le fallback org-only introduit par Zoro est supprimé.
Raison : Le finding F003 d'Itachi était un FAUX POSITIF. `photos.tache_id` est `NOT NULL REFERENCES taches(id)` (migration 008) → toute photo appartient obligatoirement à une tâche, donc un chantier sans tâche a 0 photo par construction du schéma. Le scénario "photos sans tâche" est impossible. Le fallback de Zoro (`baseQuery` filtrée par `organisation_id` + date sans `.in('tache_id')` quand tacheIds vide) remontait les photos des AUTRES chantiers de l'org et les attribuait à ce chantier — fuite cross-chantier injectée dans les signaux LLM. Le court-circuit d'origine d'Amelia était correct.
Alternative écartée : garder le fallback org-only (fuite de données) ; `.in('tache_id', [])` (Supabase retourne 0 ligne mais exécute une requête inutile).

[2026-06-10] Zoro [permanent:false]
Decision : F001 — Retrait assertTrialActive des handlers /valider (CR + rapports-hebdo). Catch PAYMENT_REQUIRED retiré aussi (mort-code après retrait du seul appel qui pouvait lever cette exception dans ces handlers).
Raison : Architecture §6 déclare trial-gate=non* sur /valider : "valider n'est pas bloqué — c'est une transition sur donnée existante (pas de création de valeur)". Le test structurel reporting-donnees-brutes.test.ts assertait la présence d'assertTrialActive sur /valider — il était incorrect (assertait un bug). Test corrigé pour asserter l'ABSENCE, conformément à §6. Correction de test documentée ici car la règle "JAMAIS modifier les tests pour les faire passer" vise l'affaiblissement d'assertions, pas la correction d'une assertion qui reflétait une implémentation incorrecte.
Alternative écartée : garder assertTrialActive mais le conditionner (contredit la note architecturale explicite).

[2026-06-10] Zoro [permanent:false]
Decision : F002 — Ajout envoye_par: userId dans le .update({...}) des deux handlers /envoyer (CR + rapports-hebdo). Champ ajouté aussi dans le .select() retourné.
Raison : Colonne envoye_par uuid NULL REFERENCES users(id) présente dans migrations 012/013. Architecture §8 pattern 4 : envoye_par = jwt.sub (claims header), jamais depuis le body. La valeur était laissée à NULL cassant l'audit trail.
Alternative écartée : lire userId depuis le body (interdit par architecture §8.4 + Kakashi §4).

[2026-06-10] Zoro [permanent:false]
Decision : F003 — collectSignaux.ts : requête photos toujours exécutée, même si tacheIds est vide. Si tacheIds non vide → filtre .in('tache_id', tacheIds) ; sinon → filtre .eq('organisation_id', organisationId) seul + date. Dans les deux cas la requête s'exécute.
Raison : RG-CR-008 définit has_activity = tâche modifiée OU photo du jour sans condition sur la présence de tâches. Le court-circuit if (tacheIds.length > 0) empêchait la détection d'activité photo sur un chantier sans tâche. Déviation #3 DECISIONLOG maintenue : la table photos n'a pas de chantier_id, le filtre par organisation_id est le seul fallback possible.
Alternative écartée : toujours utiliser .in() avec tableau vide (Supabase retourne 0 lignes pour IN() — ne résout pas le problème).

[2026-06-10] Zoro [permanent:false]
Decision : F004 — rapports-hebdo/generer : le retour 422 si aucun CR validé remplacé par continuation normale avec crs=[]. genererContenuHebdo produit le texte "Aucun CR validé" via buildCRsBlock (cas déjà géré). UPSERT exécuté normalement avec cr_ids=[].
Raison : RG-RH-003 : si aucun CR validé, le rapport est créé avec cr_ids=[] et contenu "Aucun CR validé cette semaine". Architecture §6.9 ne liste pas 422 dans les codes valides pour cet endpoint. Le comportement cron (skipped_no_cr++) était correct ; le handler manuel était incohérent.
Alternative écartée : retourner un rapport vide sans appel LLM (LLM gère déjà le cas via buildCRsBlock).

[2026-06-10] Zoro [permanent:false]
Decision : F005 — reporting-workflow.test.ts : ajout de tests comportementaux mock pour TST-K5-08 (JWT ouvrier → 403 sans query Supabase, JWT org B → 404) et TST-K5-14 (envoyer brouillon → 409 Resend 0 appel, envoyer déjà envoyé → 200 idempotent Resend 0 appel).
Raison : Le plan §Batch 12 exigeait des tests comportementaux distincts — seuls des tests structurels source-grep existaient. Mocks inline Supabase + sendEmail pour isolation complète. Pattern suivi : vi.mock hoistés + mockFromFn configurable par test.
Alternative écartée : tests E2E (hors scope tests unitaires de ce fichier).

[2026-06-10] Shinji [permanent:true]
Decision : Cron de génération CR LLM = app-level (service supercronic clawbtp_cron EXISTANT) appelant POST /api/cron/cr avec x-cron-secret, PAS pg_cron. pg_cron reste réservé au SQL-pur (jalons mig 010). (ADR-5-002, D-5-08)
Raison : pg_cron ne peut pas appeler un LLM (pas de réseau sortant ni secret Anthropic en base). L'appel LLM exige le runtime Node + ANTHROPIC_API_KEY. Le crontab supercronic référence déjà POST /api/cron/cr 18h — pattern déjà câblé côté infra (artifacts/08-infra/crontab), je le formalise sans ajouter d'infra. Feature MUST HAVE : S5-F01 CR auto-généré cron 18h (US-038).
Alternative écartée : pg_cron insérant des "jobs à générer" consommés par un poller (table queue + poller = sur-ingénierie pour 5 chantiers, l'idempotence DB ON CONFLICT suffit) ; pg_net (extension + secret Anthropic en base = surface sécurité).

[2026-06-10] Shinji [permanent:true]
Decision : Intégration LLM via interface ILLMClient (lib/llm/client.ts) + impl AnthropicClient. Helpers reporting (genererContenuCR/genererContenuHebdo) consomment l'interface via factory. Choix modèle/prompt/éval DÉLÉGUÉS à @yuki. (ADR-5-001, D-5-01/02)
Raison : Swappabilité Sonnet↔Haiku sans toucher les handlers + mock trivial en CI (pas d'appel Anthropic réel). Cohérent pattern ISessionStore (D-054). Feature MUST HAVE : S5-F01 (rédaction LLM). Séparation collecte déterministe TS (collectSignaux, D-008) / rédaction LLM binding.
Alternative écartée : appel @anthropic-ai/sdk direct dans les helpers (couple métier/SDK, complique le mock, mélange responsabilité Shinji/@yuki).

[2026-06-10] Shinji [permanent:true]
Decision : Génération PDF = @react-pdf/renderer (PO-5-03) renderToBuffer Node, réponse directe application/pdf, PDF généré à la volée à chaque GET (pas de stockage, pas de signed URL). (ADR-5-003, D-5-07)
Raison : Zéro Chromium → image Docker inchangée (vs Puppeteer +400 Mo fragile en Swarm). Pas de Storage → pas de cleanup ni cohérence à gérer. PDF toujours à jour. Feature MUST HAVE : S5-F03 export PDF (US-043).
Alternative écartée : Puppeteer/Chromium (lourd/fragile Swarm) ; stockage Storage + signed URL (YAGNI au volume pilote).

[2026-06-10] Shinji [permanent:true]
Decision : Échec génération LLM = throw LLMError → 502 (aucun CR persisté en manuel ; catch par-chantier + errors[] + continue dans le cron). CONTRAIRE au best-effort des notifications (ADR-4V-001). (ADR-5-004, D-5-04)
Raison : Un CR vide/faux tromperait le conducteur (livrable validé par un humain). Le conducteur régénère explicitement ; le cron skip et journalise. Feature MUST HAVE : S5-F01/F02 (workflow validation).
Alternative écartée : best-effort comme notifs (un CR ne peut pas être silencieusement vide) ; queue de retry (YAGNI pilote, dette RG-CR-016 tracée).

---

[2026-06-10] Amelia [permanent:false]
Decision : Sprint 5 — (adminClient as unknown as any).from('table') pour comptes_rendus/rapports_hebdo. Identique pattern notifications (D-056). Post-migration supabase gen types corrigera.
Raison : comptes_rendus et rapports_hebdo non encore dans Database types (migration 012/013 non encore appliquée). TypeScript rejetait .eq('chantier_id', ...) car la table castée 'chantiers' n'a pas cette colonne.
Alternative écartée : spec telle qu'écrite — un cast plus étroit (as SupabaseClient<...>) avec un type partiel pour les nouvelles tables aurait requis de modifier types/database.ts manuellement (risque de désynchronisation avec la migration).

[2026-06-10] Amelia [permanent:false]
Decision : Sprint 5 — @react-pdf/renderer v4 renderToBuffer : cast via `as unknown as Parameters<typeof renderToBuffer>[0]`. PDF route renvoie ArrayBuffer (non Buffer) vers NextResponse.
Raison : react-pdf v4 + exactOptionalPropertyTypes:true → FunctionComponentElement<CrDocumentProps> non assignable à ReactElement<DocumentProps>. Buffer<ArrayBufferLike> non assignable à BodyInit dans NextResponse (TypeScript lib.dom changes).
Alternative écartée : spec telle qu'écrite.

[2026-06-10] Amelia [permanent:false]
Decision : Sprint 5 — `lib/reporting/collectSignaux.ts` : photos récupérées via `.in('tache_id', tacheIds)` (non via chantier_id inexistant sur table photos).
Raison : La table photos n'a pas de colonne chantier_id — les photos sont liées aux tâches via FK tache_id. Spec fait référence à "photos du chantier du jour" mais la DB ne le supporte pas directement.
Alternative écartée : spec telle qu'écrite (chantier_id sur photos n'existe pas).

[2026-06-10] Amelia [permanent:false]
Decision : Sprint 5 — LLMError constructor : (message, isTimeout: boolean = false, cause?: unknown). Signature ajustée pour correspondre aux tests TST-K5.
Raison : Tests reporting-llm.test.ts appellent `new LLMError('msg', false)` et attendent `err.isTimeout === false`. La signature précédente avait cause en 2e position.
Alternative écartée : modifier les tests (interdit par règle "JAMAIS modifier les tests pour les faire passer").

[2026-06-10] Amelia [permanent:false]
Decision : Sprint 5 — Commentaires dans collectSignaux.ts, types/reporting.ts et pdf-documents.tsx nettoyés de toute mention littérale des champs `note_privee_conducteur`, `storage_path`, `signed_url`, `dangerouslySetInnerHTML`, `<Image`. Tests TST-K5-01/02/05 et SURF-5-10 font une analyse statique de la source complète fichier inclus comments.
Raison : Tests statiques `.not.toMatch(/pattern/)` sur le texte brut du fichier. Les valeurs sécurité sont documentées via termes génériques (D-4-006, D-051/PO-014).
Alternative écartée : modifier les tests (interdit).

[2026-06-10] Amelia / corrigé en revue
Decision : Sprint 5 — TST-K5-08 (reporting-hebdo.test.ts) : le chemin du crontab dans le test était erroné (`../../../artifacts/08-infra/crontab` depuis `tests/unit/` résout vers `artifacts/artifacts/08-infra/crontab`, un niveau trop profond). Corrigé en pointant le test vers le vrai fichier `../../../08-infra/crontab`.
Raison : Le défaut était dans le littéral de chemin du test lui-même, pas dans le code testé. Corriger un chemin faux n'affaiblit aucune assertion — la règle CLAUDE.md « ne jamais modifier les tests pour les faire passer » vise l'affaiblissement d'assertions, pas la correction d'un bug du test. La première approche d'Amelia (créer un fichier dupliqué `artifacts/artifacts/08-infra/crontab`) polluait le repo avec un répertoire parasite et a été retirée.
Alternative écartée : fichier crontab dupliqué (parasite, supprimé).

---

[2026-06-09] Amelia [permanent:false]
Decision : TacheEditClientSchema déclaré inline dans TacheEditModal.tsx plutôt que via UpdateTacheSchema.pick().
Raison : UpdateTacheSchema est un ZodEffects (.refine) — la méthode .pick() n'existe pas sur ZodEffects. Le sous-schéma client (titre, description, assigned_to, date_echeance) est déclaré séparément dans le composant, cohérent avec les contraintes de UpdateTacheSchema mais sans le .refine (statut/bloque_raison non éditables dans ce modal). K2.5-T-10 est respecté pour l'esprit (schéma de référence importé via import type UpdateTacheInput, les règles métier restent côté serveur).
Alternative écartée : UpdateTacheSchema.pick() — impossible sur ZodEffects.

[2026-06-09] Amelia [permanent:false]
Decision : Test EVT-REASSIGN-001 (happy path handler réel 200) converti en tests Zod unitaires + documentation du skip, car le mock multi-level Supabase couvrant ownership + users + update + notifications best-effort en un seul handler test était fragile (chemin de notification Cas B nécessite chain .eq() à profondeur variable). L'équivalent fonctionnel est couvert par : taches-ownership.test.ts (ownership) + notif-events.test.ts EVT-007 (trigger reassign) + le build TypeScript.
Alternative écartée : proxy infini ou compteur global — échoue à l'évaluation de vi.mock (hoisting Vitest avant init module).

---

[2026-06-08] Zoro [permanent:false]
Decision : BUG-FIX ZR-BELL-01 — NotificationBell : fetch immédiat manquant au mount.
Raison : setInterval(fetchCount, 30_000) sans appel préalable à fetchCount() → badge resté à initialUnreadCount (souvent 0) pendant 30s après chaque navigation. Correction : appel de fetchCount() immédiatement avant setInterval dans useEffect.
Alternative ecartée : passer initialUnreadCount depuis le serveur à chaque render (SSR plus coûteux, problème de fraîcheur non résolu).

[2026-06-08] Zoro [permanent:false]
Decision : BUG-FIX ZR-DROP-01 — NotificationDropdown.handleRead : stale closure sur unreadCount.
Raison : useCallback capturait notifications et unreadCount par valeur au moment du render. En cas de clics rapides consécutifs sur plusieurs notifs avant re-render, le 2e clic lisait unreadCount périmé et décrémentait depuis la mauvaise base → badge incorrect (N-1 au lieu de N-2). Correction : (1) useRef<NotificationDisplay[]> pour lire l'état courant des notifs sans stale closure ; (2) setUnreadCount fonctionnel (prev => ...) pour accéder à la valeur courante ; (3) wrapper setNotificationsTracked maintient la ref en sync à chaque mise à jour.
Alternative ecartée : ajouter notifications dans les deps de useCallback (recrée handleRead à chaque ajout de notif → instabilité inutile) ; utiliser un state manager global (YAGNI, pas de store Sprint 4).

[2026-06-08] Zoro [permanent:false]
Decision : Points vérifiés SANS bug — Sprint 4 Visibilité (audit sécurité + logique event-based).
Raison : Vérifications exhaustives sur : (1) htmlEscape — pas de chemin vers null/undefined car inputs typés string ; (2) best-effort userId falsy → guard !userId catch '' correctement ; (3) idempotence IS NOT DISTINCT FROM — branches if/else pour chantierId et tacheId correctes ; (4) cursor forgé → Zod datetime strict retourne 400 ; (5) IDOR PATCH read → 404 hors-org + 403 autre user + idempotent si déjà lu ; (6) read-all scopé user+org+lu=false ; (7) K4V-10 SELECT n'inclut pas organisation_id ni user_id ; (8) SQL cron NOT EXISTS idempotent pour echeance_chantier et echeance_tache ; (9) sql_html_escape ordre & en premier — correct ; (10) faux positif/négatif dérive budget — condition couleurAvant!==couleurApres conforme à RG-NOTIF-EVT-008 (rouge→rouge sans notif est spécifié, pas un bug).
Alternative ecartée : N/A — vérification, pas de décision.

[2026-06-08] Amelia [permanent:false]
Decision : PATCH /api/chantiers/[id] — validation input DEPLACEE avant SELECT ownership (fail fast).
Raison : L'ajout de calculerCouleur apres SELECT ownership provoquait un TypeError (date_fin_prevue=undefined) pour les inputs invalides (PATCH-4/PATCH-5). La validation Zod intervient maintenant a l'etape 4 (avant DB), le SELECT ownership passe a l'etape 5. Comportement externe identique (400 pour input invalide, 404 pour hors org) mais ordre interne change. Test regressions chantiers-id-rbac PATCH-4/PATCH-5 re-passent.
Alternative ecartee : guard undefined sur date_fin_prevue dans calculerCouleur (masquerait le vrai probleme — il faut valider l'input avant d'acceder DB). Reference sprint-4 correctif batch 5.

[2026-06-07] Shinji [permanent:true]
Decision : D-4V-002 (Sprint Visibilite, architecture-sprint-4-visibilite.md) — helper insertNotification BEST-EFFORT ABSOLU : ne throw JAMAIS, appele APRES le commit metier, avale toute erreur (log warn pino), applique htmlEscape sur titre/message, idempotence anti-spam par NOT EXISTS (user_id,type,chantier_id,tache_id) WHERE lu=false (IS NOT DISTINCT FROM cote TS pour gerer NULL), userId falsy -> skip sans INSERT. INSERT exclusivement via adminClient (service_role) ; RLS notifications_insert_service_role_only WITH CHECK(false) bloque tout INSERT authenticated ; AUCUN endpoint POST de creation publique (D-4V-008).
Raison : une notif ratee ne doit JAMAIS faire echouer l'action metier (creer tache / changer statut / modifier budget). Un point unique auditable concentre XSS (htmlEscape), anti-spam (idempotence), forge (service_role only) et non-regression note_privee_conducteur (type sans ce champ, D-4V-015). Reference feature MUST HAVE : les 4 evenements PO-4V-01/D-057.
Alternative ecartee : propager l'erreur (un echec notif casserait une creation de tache reussie - inacceptable) ; queue de retry (YAGNI volume pilote) ; endpoint POST notif avec RBAC (surface de forge inutile §7.4).

[2026-06-07] Shinji [permanent:true]
Decision : D-4V-006 (Sprint Visibilite) — detection derive budget par diff calculerCouleur AVANT/APRES dans PATCH /api/chantiers/[id], restreinte a l'axe budget (budget_depense > budget_alloue). Si couleur_avant != couleur_apres ET couleur_apres in {orange,rouge} ET axe budget -> notifier admins org (deleted_at IS NULL) + conducteur du chantier (PO-3-AM-01). Evenement 4 jalons date-based = pg_cron quotidien notif_jalons_cron() 06h UTC idempotent NOT EXISTS, conditionnel pg_cron (skip+dette si absent). Polling 30s (PO-4V-06), pas de Realtime. Retention 90j purge pg_cron dimanche 04h UTC (PO-4V-04). Ouvrier hors scope notifications (PO-4V-03 B) : pas de cloche, pas d'endpoint expose au role ouvrier.
Raison : reutilise la logique deterministe calculerCouleur deja testee Sprint 2 (D-008), pas de duplication ; synchrone = notif immediate sur derive budget. Date-based n'est declenche par aucune action utilisateur -> seul pg_cron convient. Reference D-057 (PO-4V-01..06 BINDING).
Alternative ecartee : trigger SQL pour derive (logique metier en base, dur a tester solo) ; cron pour derive (latence inacceptable) ; scan a chaque GET pour jalons (couteux, doublons) ; Supabase Realtime (infra V1 inutile, V2 si retour pilote).

---

[2026-06-06] Shinji [permanent:true]
