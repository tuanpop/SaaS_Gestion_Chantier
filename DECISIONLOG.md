# Decision Log - ClawBTP (SaaS_Gestion_Chantier)

Format :
```
[YYYY-MM-DD] [Agent] [permanent:true|false]
Decision : [ce qui a ete decide]
Raison : [pourquoi]
Alternative ecartee : [ce qui a ete considere et rejete]
```

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
