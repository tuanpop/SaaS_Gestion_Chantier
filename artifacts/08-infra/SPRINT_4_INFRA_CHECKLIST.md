# Checklist infra Sprint 4 — ClawBTP
*Produit : 2026-06-07 | Tanjiro | Sprint 4 (Complétion terrain : upload photos, logout ouvrier, UI conducteur, pg_cron)*
*A exécuter dans l'ordre, avant et après le merge squash `sprint-4/completion-terrain` → main*
*Références : D-4-001, D-4-004, D-4-008, D-4-011, D-4-012, D-4-013, D-4-014, D-4-018, D-4-019*
*Guide détaillé migrations : `artifacts/08-infra/MIGRATION_008_009_APPLY.md`*

---

## Phase A — Pré-deploy (AVANT le merge squash)

### A0 — Vérification trial org TPopulo (BLOQUANT smoke prod)

**⚠️ BLOQUANT pour le smoke upload photos en prod** (détecté D-056) : le trial org TPopulo est expiré. Les mutations (POST photos, PATCH, DELETE) retourneront 402 jusqu'à prolongation.

- [ ] Vérifier l'état du trial via SQL Editor Supabase :
  ```sql
  SELECT id, nom, trial_ends_at, statut
  FROM public.organisations
  WHERE id = (SELECT organisation_id FROM public.users WHERE email = 'tpopulo@orkesyn.com' LIMIT 1);
  ```
- [ ] Si `trial_ends_at < NOW()` : exécuter la prolongation avant le smoke :
  ```sql
  UPDATE public.organisations
  SET trial_ends_at = NOW() + INTERVAL '90 days',
      statut = 'trial_active'
  WHERE id = (SELECT organisation_id FROM public.users WHERE email = 'tpopulo@orkesyn.com' LIMIT 1);
  ```
- [ ] Cocher + noter la date : ____________________

Ref : D-012, D-056 §7.4.

---

### A1 — Migration 008 Supabase Dashboard (BLOQUANT)

**BLOQUANT** : sans cette migration, `POST /api/photos` échoue (table absente), `GET /api/ouvrier/chantiers/[id]` échoue sur le SELECT photos.

- [ ] Exécuter l'audit initial (requêtes 0a + 0b + 0c de `MIGRATION_008_009_APPLY.md` Partie 1) — confirmer 0 lignes (table absente) et 3 lignes (tables de référence présentes)
- [ ] Copier-coller et exécuter le SQL de migration 008 complet (Partie 1, Étape 1 de `MIGRATION_008_009_APPLY.md`)
- [ ] Résultat attendu : `Success. No rows returned.`
- [ ] Exécuter les vérifications post-migration (requêtes 2a à 2f de `MIGRATION_008_009_APPLY.md`) — confirmer table + 4 index + policy RLS + GRANTs
- [ ] Cocher + noter la date d'application : ____________________

Ref : D-4-012, `MIGRATION_008_009_APPLY.md` Partie 1.

---

### A2 — Création bucket Storage `photos` (BLOQUANT)

**BLOQUANT** : sans ce bucket, `adminClient.storage.from('photos').upload(...)` retourne une erreur 502 depuis le Route Handler.

- [ ] Ouvrir Supabase Dashboard > **Storage** > **Buckets** > **New bucket**
- [ ] Nom du bucket : `photos` (sensible à la casse — doit correspondre exactement au `.from('photos')` hardcodé dans le code)
- [ ] Public bucket : **NON** (décoché) — bucket privé D-4-013/PO-4-03 BINDING
- [ ] File size limit : `10 MB` (10485760 octets)
- [ ] Allowed MIME types : `image/jpeg, image/png, image/webp` (HEIC retiré — D-056/PO-4-02 amende 2026-06-07)
- [ ] Cliquer **Create bucket** — confirmer que le bucket `photos` apparaît dans la liste
- [ ] Vérifier `Public = false` dans les détails du bucket
- [ ] **Aucune policy Storage à créer** (ouvrier via service_role, conducteur via code — D-4-001/D-4-014)
- [ ] Cocher + noter la date : ____________________

Ref : D-4-001, D-4-012, D-4-013, `MIGRATION_008_009_APPLY.md` Partie 2.

---

### A3 — Variables d'environnement Dokploy (vérification)

**Aucune nouvelle variable d'environnement requise pour Sprint 4.** Le code Storage utilise `SUPABASE_SERVICE_ROLE_KEY` et `NEXT_PUBLIC_SUPABASE_URL` déjà présentes (mêmes vars que pour les sessions Postgres D-054). Le nom du bucket `photos` est hardcodé dans le code (pas de var env — voir Finding F-ENV-01 ci-dessous).

- [ ] `SUPABASE_SERVICE_ROLE_KEY` présente dans Environment Dokploy — **PAS** dans Build-time Arguments, **PAS** de préfixe `NEXT_PUBLIC_`
  - Vérifier : Dokploy > service `saas-gestion-chantier-app` > Environment > chercher `SUPABASE_SERVICE_ROLE_KEY`
  - Si absente : l'ajouter (valeur dans `.env.local`, jamais dans le repo git)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` présente dans Environment ET Build-time Arguments (même valeur)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` présente dans Environment ET Build-time Arguments (même valeur)
- [ ] `QR_ENCRYPTION_KEY` présente dans Environment uniquement (64 chars hex, inchangée depuis Sprint 3 — ne jamais modifier)
- [ ] `RESEND_API_KEY` présente dans Environment uniquement
- [ ] `NEXT_PUBLIC_APP_URL` = `https://saas-gestion-chantier.tanren-studio.com` dans Environment ET Build-time Arguments
- [ ] **Optionnel** (cleanup D-054 non encore fait) : retirer `REDIS_URL` et `DISABLE_REDIS` si encore présents — ne bloquent pas le deploy

Ref : D-027, D-054, TNJ-K3-02.

---

### A4 — Migration 009 Supabase Dashboard (CONDITIONNEL — pg_cron)

**Conditionnel** : appliquer seulement si pg_cron est disponible sur le plan Supabase. Skip documenté si absent (seuil alerte 10 000 lignes `ouvrier_sessions`, jamais atteint en pilote 60j).

- [ ] Vérifier disponibilité pg_cron : Dashboard > **Database** > **Extensions** > chercher `pg_cron`
  - OU via SQL : `SELECT name, installed_version FROM pg_available_extensions WHERE name = 'pg_cron';`

**Si pg_cron disponible :**
- [ ] Activer l'extension si non activée (toggle Dashboard OU `CREATE EXTENSION IF NOT EXISTS pg_cron;`)
- [ ] Exécuter l'audit initial (requête 5b-1 de `MIGRATION_008_009_APPLY.md`) — confirmer 0 lignes (job absent)
- [ ] Copier-coller et exécuter le SQL de migration 009 (Partie 3, Étape 5b de `MIGRATION_008_009_APPLY.md`)
- [ ] Vérifier le job enregistré (requête 5b-3) : `jobname = cleanup-ouvrier-sessions-expires`, `active = true`
- [ ] Cocher + noter la date : ____________________

**Si pg_cron absent :**
- [ ] Cocher "SKIPPÉE — pg_cron absent" et documenter dans `memory/PROJECT_STATE.md` section "Dette tracée"

Ref : D-4-011, `MIGRATION_008_009_APPLY.md` Partie 3.

---

### A5 — Gates locaux sur la branche `sprint-4/completion-terrain`

- [ ] `npm run lint` passe (0 erreur, 0 warning)
- [ ] `tsc --noEmit` passe (0 erreur TypeScript)
- [ ] `npm test` passe (Vitest — 0 failed)
- [ ] `npm run build` passe (next build — 0 erreur, pas de `Type error:`)

Ref : CLAUDE.md conventions, D-031.

---

## Phase B — Deploy

### B1 — Squash merge et push

- [ ] Squash merge `sprint-4/completion-terrain` → `main` effectué
- [ ] `git push origin main` exécuté
- [ ] Commit hash sur main noté : ____________________

Ref : D-031.

### B2 — Dokploy rebuild déclenché

- [ ] GitHub Actions CI complète sans erreur : `https://github.com/tuanpop/SaaS_Gestion_Chantier/actions`
- [ ] Webhook Dokploy déclenche un rebuild automatique (Dokploy > service `saas-gestion-chantier-app` > Deployments)
  - OU rebuild manuel : Dokploy > **Deploy** (si auto-deploy désactivé)
- [ ] Build Docker complète sans erreur (logs Dokploy > Deployments > dernier build)

### B3 — Container redémarrage confirmé

- [ ] Service `saasgestionchantierapp-*` passe en statut **running** dans Dokploy
- [ ] Aucune alerte rouge dans le dashboard Dokploy

### B4 — Health check

- [ ] `GET https://saas-gestion-chantier.tanren-studio.com/api/health` retourne HTTP 200 :
  ```
  curl -s https://saas-gestion-chantier.tanren-studio.com/api/health
  ```
  Réponse attendue : `{"data":{"status":"ok",...}}`

---

## Phase C — Vérifications post-deploy

### C1 — Smoke API upload (curl)

Ces commandes vérifient les routes Sprint 4 sans device mobile. Elles nécessitent un cookie `ouvrier_session` valide (obtenu par scan QR) et les IDs appropriés.

**C1a — Vérifier que POST /api/photos est accessible (sans auth → 401)**

```
curl -s -o /dev/null -w "%{http_code}" -X POST https://saas-gestion-chantier.tanren-studio.com/api/photos
```

Résultat attendu : `401` (pas d'auth → refus, pas de 500).

**C1b — Vérifier que DELETE /api/photos/[id] sans auth → 401**

```
curl -s -o /dev/null -w "%{http_code}" -X DELETE https://saas-gestion-chantier.tanren-studio.com/api/photos/00000000-0000-0000-0000-000000000000
```

Résultat attendu : `401`.

**C1c — Vérifier le middleware laisse passer /api/photos (pas de redirect 307 JWT)**

```
curl -sI -X POST https://saas-gestion-chantier.tanren-studio.com/api/photos
```

Résultat attendu : `HTTP/2 401` (pas `307 Temporary Redirect`). Si 307 : le middleware route encore `/api/photos` vers la branche JWT bloquante — voir Finding F-MW-01.

**C1d — Vérifier POST /api/ouvrier/logout idempotent (sans cookie → 200)**

```
curl -s -o /dev/null -w "%{http_code}" -X POST https://saas-gestion-chantier.tanren-studio.com/api/ouvrier/logout
```

Résultat attendu : `200` (idempotent — D-4-008, RG-LOGOUT-003).

### C2 — Headers sécurité (hérités Sprint 3, à re-vérifier)

- [ ] `Cache-Control: no-store` sur `/ouvrier/no-affectation` :
  ```
  curl -sI https://saas-gestion-chantier.tanren-studio.com/ouvrier/no-affectation
  ```
- [ ] `X-Robots-Tag: noindex, nofollow` sur `/ouvrier/no-affectation` : idem commande ci-dessus

Ref : TNJ-K3-06.

### C3 — Vérification bucket Storage actif

- [ ] Dans Supabase Dashboard > Storage > `photos` : le bucket est vide (0 fichier) et `Public = false`
- [ ] Aucune erreur dans les logs Dokploy liée à `from('photos')` (grep sur les 5 premières minutes après deploy)
  ```
  ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000 "sudo docker service logs saas-gestion-chantier-app_web --since 5m 2>&1 | grep -i 'photos\|storage\|bucket'"
  ```

---

## Phase D — Smoke prod ouvrier Sprint 4 (device mobile réel)

**Prérequis smoke** :
- Trial org TPopulo prolongé (Étape A0)
- Un ouvrier test avec au moins 1 tâche assignée active (statut `a_faire` ou `en_cours`)
- Un conducteur test sur le même chantier
- Cookie `ouvrier_session` valide obtenu par scan QR

### D1 — Upload photo (S4-F01)

- [ ] Sur le smartphone : accéder à `/ouvrier/chantiers/[id]` avec une tâche assignée
- [ ] Cliquer sur le bouton upload photo (caméra) d'une tâche
- [ ] Prendre une photo (JPEG) — ou sélectionner depuis la galerie
- [ ] Confirmer l'upload (POST `/api/photos`) → résultat 201, photo apparaît dans la galerie
- [ ] Vérifier dans DevTools Network : la réponse 201 contient `signed_url` mais **pas** `storage_path`
- [ ] Vérifier dans Supabase Dashboard > Storage > `photos` : le fichier apparaît sous `{org_id}/{tache_id}/`
- [ ] Vérifier que l'URL de la photo dans l'UI contient `token=` (signed URL) et non un chemin direct

Ref : D-4-001, D-4-006, D-4-007, RG-PHOTO-001.

### D2 — Commentaire photo (S4-F01 — PATCH)

- [ ] Cliquer sur l'icône crayon d'une photo uploadée
- [ ] Saisir un commentaire (≤ 500 chars) et sauvegarder
- [ ] PATCH `/api/photos/[id]` → 200
- [ ] Le commentaire apparaît sous la photo dans la galerie

Ref : D-4-003.

### D3 — Suppression photo par l'ouvrier auteur (S4-F01 — DELETE)

- [ ] Cliquer sur l'icône poubelle d'une photo uploadée (dialog de confirmation)
- [ ] Confirmer la suppression
- [ ] DELETE `/api/photos/[id]` → 204
- [ ] La photo disparaît de la galerie
- [ ] Vérifier dans Supabase Dashboard > Storage > `photos` : le fichier est supprimé (ou absent — best-effort)

Ref : D-4-002, D-4-009.

### D4 — Logout ouvrier (S4-F03)

- [ ] Cliquer sur le bouton Logout dans le header de la vue ouvrier
- [ ] La page redirige vers `/ouvrier/scan`
- [ ] Vérifier dans DevTools > Application > Cookies : `ouvrier_session` est absent ou `Max-Age=0`
- [ ] Tenter d'accéder à `/ouvrier/chantiers` directement → redirect vers `/ouvrier/scan` (session supprimée)
- [ ] Tester idempotence : appeler `POST /api/ouvrier/logout` sans cookie → réponse 200 (pas d'erreur)

Ref : D-4-008, RG-LOGOUT-002/003.

### D5 — Modération conducteur photos (S4-F01/F005)

- [ ] En tant que conducteur, accéder à `/conducteur/chantiers/[id]`
- [ ] La grille de modération photos s'affiche (photos de la tâche uploadées par l'ouvrier)
- [ ] Vérifier dans DevTools Network : la page est SSR (pas de fetch GET `/api/photos` côté client — D-4-019)
- [ ] Les photos s'affichent via `signed_url` (attribut `src` contient `token=`)
- [ ] Cliquer sur "Supprimer" d'une photo > dialog de confirmation > confirmer
- [ ] DELETE `/api/photos/[id]` → 204 (chemin staff D-4-002)
- [ ] La photo disparaît de la grille

Ref : D-4-002, D-4-019, F005.

### D6 — UI conducteur champs S4-F02

- [ ] Note privée conducteur : champ Textarea visible avec badge "Interne — invisible pour l'ouvrier"
- [ ] Saisir et sauvegarder une note → PATCH `/api/taches/[id]` → 200
- [ ] La note persiste après rechargement de la page
- [ ] Onglet Équipe : téléphone conducteur affiché si non null (lien `tel:`)
- [ ] Vérifier côté ouvrier : `GET /api/ouvrier/chantiers/[id]` → `note_privee_conducteur` absent de la réponse JSON

Ref : D-4-010, RG-NPR-002/003.

---

## Phase E — Vérification pg_cron (si migration 009 appliquée)

- [ ] Attendre que le job ait tourné AU MOINS UNE FOIS (ou le simuler manuellement pour le smoke) :
  ```sql
  -- Simuler le cleanup manuellement pour vérification :
  DELETE FROM public.ouvrier_sessions WHERE expires_at < NOW();
  ```
  Résultat attendu : 0 ou N lignes supprimées (sessions expirées).
- [ ] Vérifier dans `cron.job_run_details` après 03h00 UTC (le lendemain du deploy) :
  ```sql
  SELECT jobid, status, return_message, start_time, end_time
  FROM cron.job_run_details
  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'cleanup-ouvrier-sessions-expires')
  ORDER BY start_time DESC
  LIMIT 5;
  ```
  Résultat attendu : `status = succeeded`.

Ref : D-4-011.

---

## Récapitulatif des actions par responsabilité

| Action | Responsable | Ref | Bloquant ? |
|--------|-------------|-----|-----------|
| Prolonger trial org TPopulo | Dev/PO | D-012, D-056 | OUI — smoke prod photos impossible sinon |
| Migration 008 SQL Editor Supabase | Dev/PO | D-4-012 | OUI — upload/photos impossible sinon |
| Bucket Storage `photos` (privé) | Dev/PO | D-4-001, D-4-013 | OUI — upload Storage impossible sinon |
| Vérifier `SUPABASE_SERVICE_ROLE_KEY` Dokploy | Dev/PO | D-027, D-015 | OUI — admin client requis pour Storage |
| Migration 009 pg_cron | Dev/PO | D-4-011 | NON — hygiène, lazy cleanup suffit V1 |
| Smoke upload photo mobile réel | Dev/PO | CLAUDE.md règle validation sprint | OUI — sprint ne peut pas être validé sinon |
| Smoke logout ouvrier | Dev/PO | D-4-008 | OUI (user story livrée, smoke obligatoire) |
| Smoke modération photos conducteur | Dev/PO | D-4-019, F005 | OUI (user story livrée, smoke obligatoire) |

---

## Rollback global Sprint 4 (si deploy KO)

Si le deploy produit des erreurs critiques en production :

**Option 1 — Rollback code (Dokploy) :**
Dokploy > service `saas-gestion-chantier-app` > Deployments > sélectionner le dernier deploy Sprint 3 stable > **Redeploy**.
Le code revient à Sprint 3. Les migrations 008 et le bucket restent en place (compatibles avec le code Sprint 3 — la table `photos` vide ne gêne pas le code Sprint 3 qui avait un try/catch `42P01` pour les anciens endpoints photos_count).

**Option 2 — Rollback migration 008 (si vraiment nécessaire) :**
Voir section "Rollback migration 008" de `MIGRATION_008_009_APPLY.md`. Ne rollback que si le bucket est vide et le code Sprint 4 non déployé.

**Option 3 — Rollback bucket :**
Storage > Buckets > `photos` > vider > Delete. Ne rollback que si aucun fichier n'a été uploadé.

---

## Note post-deploy : monitoring Storage

Vérifier périodiquement la taille du bucket dans Supabase Dashboard > Storage > `photos` (pilote 60j).
Si la taille dépasse 1 Go : alerter PO (quota Storage plan Supabase à vérifier).
Ref : D-05 threat-model (quota org = gate pré-commercialisation).
