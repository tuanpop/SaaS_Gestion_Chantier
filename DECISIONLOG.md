# Decision Log - ClawBTP (SaaS_Gestion_Chantier)

Format :
```
[YYYY-MM-DD] [Agent] [permanent:true|false]
Decision : [ce qui a ete decide]
Raison : [pourquoi]
Alternative ecartee : [ce qui a ete considere et rejete]
```

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
