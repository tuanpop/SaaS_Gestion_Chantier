# Checklist infra Sprint 3 — ClawBTP
*Produit : 2026-06-02 | Tanjiro | Sprint 3*
*A executer dans l'ordre, avant et apres le merge squash sprint-3/ouvrier → main*
*Reference : D-3-007, D-3-012, D-3-013, D-039, TNJ-K3-01 a TNJ-K3-10*

---

## Phase A — Pre-deploy (a faire AVANT le merge squash)

### A1 — Migration 006 Supabase Dashboard

- [ ] Ouvrir Supabase Dashboard > SQL Editor > New query
- [ ] Executer l'audit initial (requete 0a + 0b de `MIGRATION_006_APPLY.md`) — confirmer 0 lignes
- [ ] Copier-coller et executer le SQL de migration 006 complet (cf. `MIGRATION_006_APPLY.md` etape 1)
- [ ] Executer les verifications post-migration (requetes 2a + 2b + 2c de `MIGRATION_006_APPLY.md`) — confirmer 1 ligne chacune
- [ ] Cocher + noter la date d'application : ____________________

Ref : D-3-007, MIGRATION_006_APPLY.md

### A1b — Migration 007 Supabase Dashboard (NOUVEAU — D-054 BLOQUANT)

**BLOQUANT** : sans cette migration, le scan QR redirige vers server_error (table ouvrier_sessions absente).

- [ ] Ouvrir Supabase Dashboard > SQL Editor > New query
- [ ] Executer l'audit initial (requete 0a de `MIGRATION_007_APPLY.md`) — confirmer 0 lignes (table absente)
- [ ] Copier-coller et executer le SQL de migration 007 complet (cf. `MIGRATION_007_APPLY.md` etape 1)
- [ ] Executer les verifications post-migration (requetes 2a + 2b + 2c + 2d de `MIGRATION_007_APPLY.md`)
- [ ] Cocher + noter la date d'application : ____________________

Ref : D-054, MIGRATION_007_APPLY.md

### A2 — Variables d'environnement QR confirmes (D-054 — REDIS_URL et DISABLE_REDIS retires)

**D-054** : `REDIS_URL` et `DISABLE_REDIS` ne sont plus necessaires (Redis supprime). Les retirer de Dokploy apres deploy reussi (optionnel — ne bloquent pas le deploy).

- [ ] `QR_ENCRYPTION_KEY` presente dans Environment Dokploy — valeur = 64 caracteres hexadecimaux (32 bytes)
  - La valeur NE COMMENCE PAS par `NEXT_PUBLIC_` — verifier que c'est bien une variable serveur uniquement
  - Ne JAMAIS changer cette valeur (invaliderait tous les QR ouvriers imprimes)
- [ ] Optionnel post-deploy : retirer `REDIS_URL` et `DISABLE_REDIS` de Environment + Build-time Arguments Dokploy

Ref : D-017, D-054, TNJ-K3-02.

### A3 — Variables Supabase, App URL et QR verifiees

### A4 — Variables Resend, App URL verifiees

- [ ] `NEXT_PUBLIC_SUPABASE_URL` presente dans Environment ET Build-time Arguments (meme valeur)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` presente dans Environment ET Build-time Arguments (meme valeur)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` presente dans Environment uniquement (PAS dans Build-time Arguments, PAS de prefixe NEXT_PUBLIC_)
- [ ] `RESEND_API_KEY` presente dans Environment uniquement
- [ ] `NEXT_PUBLIC_APP_URL` = `https://saas-gestion-chantier.tanren-studio.com` dans Environment ET Build-time Arguments

Ref : D-027.

---

## Phase B — Deploy

### B1 — Squash merge et push

- [ ] Sur branche `sprint-3/ouvrier` : `npm run build` passe (0 erreur) en local
- [ ] Gates locaux verts : `npm run lint` + `tsc --noEmit` + `npm test`
- [ ] Squash merge `sprint-3/ouvrier` → `main` effectue
- [ ] `git push origin main` execute

Ref : D-031.

### B2 — Dokploy rebuild declenche

- [ ] GitHub Actions CI complete sans erreur (https://github.com/tuanpop/SaaS_Gestion_Chantier/actions)
- [ ] Webhook Dokploy declenche automatiquement un rebuild (verifier dans Dokploy > service `clawbtp-app` > Deployments)
- [ ] OU rebuild manuel via UI Dokploy > Deploy (si auto-deploy desactive pour raison exceptionnelle)
- [ ] Build Docker complete sans erreur (logs visibles dans Dokploy > Deployments > dernier build)

### B3 — Container redemarrage confirme

- [ ] Service `saasgestionchantierapp-*` passe en statut **running** dans Dokploy apres le rolling update
- [ ] Aucune alerte rouge dans Dokploy dashboard

### B4 — Health check

- [ ] `GET https://saas-gestion-chantier.tanren-studio.com/api/health` retourne HTTP 200
  - Commande curl :
    ```
    curl -s https://saas-gestion-chantier.tanren-studio.com/api/health
    ```
  - Reponse attendue : `{"data":{"status":"ok",...}}`

---

## Phase C — Post-deploy : verifications securite headers (TNJ-K3-06 binding, K3-OQ-01)

Ces verifications sont BINDING selon Kakashi (K3-OQ-01 conditions pour accepter base64 no-affectation sans HMAC).

### C1 — Cache-Control: no-store sur /ouvrier/no-affectation

- [ ] Executer la commande curl suivante :
  ```
  curl -sI https://saas-gestion-chantier.tanren-studio.com/ouvrier/no-affectation
  ```
- [ ] Verifier que la reponse contient : `Cache-Control: no-store` (ou `no-store, no-cache, must-revalidate`)
- [ ] Verifier que le code HTTP est 200 (page publique, pas de redirect)

Si le header Cache-Control est absent : ajouter dans `app/ouvrier/no-affectation/page.tsx` (ou middleware Next.js) via `export const dynamic = 'force-dynamic'` + header explicite dans la response. Itachi phase 4 verifie que ce header est en place.

Ref : TNJ-K3-06, K3-OQ-01 condition 3.

### C2 — X-Robots-Tag: noindex, nofollow sur /ouvrier/no-affectation

- [ ] Executer la commande curl suivante :
  ```
  curl -sI https://saas-gestion-chantier.tanren-studio.com/ouvrier/no-affectation
  ```
- [ ] Verifier que la reponse contient : `X-Robots-Tag: noindex, nofollow`

Si le header est absent : ajouter via middleware Next.js ou configuration next.config.js `headers()` :
```javascript
// Dans next.config.js, section headers :
{
  source: '/ouvrier/no-affectation',
  headers: [
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
  ],
}
```

Ref : TNJ-K3-06, K3-HI-11.

### C3 — Cache-Control: no-store sur endpoints ouvrier (TST-K3-19)

- [ ] Verifier `Cache-Control: no-store` sur GET /api/ouvrier/me (necessite cookie valide — a tester post smoke)

---

## Phase D — Smoke prod ouvrier (a executer apres deploy, avec un ouvrier test)

Ces tests sont a executer sur un device mobile reel (smartphone) pour respecter la regle validation sprint CLAUDE.md (smoke UI manuel obligatoire).

Prerequis smoke : un ouvrier test doit exister en base avec au moins 1 affectation active sur un chantier.

### D1 — Session cree par scan QR

- [ ] Ouvrir la page de profil ouvrier en admin > copier l'URL du QR ou generer via `/api/users/[id]/qr`
- [ ] Scannner le QR depuis un smartphone (iOS Safari ou Android Chrome)
- [ ] La page `/ouvrier/chantiers` ou `/ouvrier/chantiers/[id]` s'ouvre
- [ ] Dans DevTools mobile (ou charles proxy) : verifier que le cookie `ouvrier_session` est pose avec `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
  - Sur iOS Safari : Reglages > Safari > Confidentialite (pas de DevTools natif — utiliser un proxy Proxyman ou tester via simulateur Xcode)
  - Sur Android Chrome : DevTools remote via chrome://inspect#devices

Ref : D-3-003, D-3-013, TST-K3-17.

### D2 — Vue chantier ouvrier charge

- [ ] Page `/ouvrier/chantiers/[id]` charge en moins de 3 secondes (3G acceptable)
- [ ] Section "Mes taches" affiche les taches assignees a l'ouvrier avec description complete et boutons action
- [ ] Section "Toutes les taches" affiche les autres taches du chantier avec description tronquee (max 120 chars) et suffixe "..."
- [ ] La cle `note_privee_conducteur` n'apparait pas dans DevTools > Network > response JSON
- [ ] Galerie photos : bouton present sur les TacheMienneCard, affiche "Aucune photo pour cette tache" (Sprint 3 : table photos absente, comportement attendu)

Ref : D-3-004, D-3-008, D-3-024, D-3-025, K3-CR-02.

### D3 — Changement statut tache

- [ ] Cliquer sur une tache "Mes taches" en statut `a_faire`
- [ ] Passer en `en_cours` : PATCH `/api/ouvrier/taches/[id]` retourne 200
- [ ] La tache s'affiche en statut `en_cours` apres rafraichissement
- [ ] Signaler un blocage : passer en `bloque` avec motif saisi dans `MotifBlocageModal`
- [ ] Lever le blocage : passer en `en_cours` depuis `bloque` (transition D-052/PO-3-05 — ouvrier peut revenir)

Ref : D-052/PO-3-05, RG-STATUT-002.

### D4 — Invalidation session sur DELETE affectation (TST-K3-10)

- [ ] En tant qu'admin, executer DELETE affectation de l'ouvrier test sur le chantier en cours
- [ ] Sur le smartphone ouvrier : tenter GET `/ouvrier/chantiers/[id]` (ou rafraichir la page)
- [ ] Resultat attendu : 401 ou redirect vers `/ouvrier/scan` (session invalidee)

Note : l'invalidation Redis est best-effort (D-3-011). Si Redis est up, le resultat est immediat. Si Redis est temporairement down, la defense applicative D-3-005 (RBAC base a chaque hit) garantit le 403 au prochain hit.

Ref : D-3-011, D-3-005, TST-K3-10.

---

## Recapitulatif des actions par responsabilite

| Action | Responsable | Ref | Bloquant ? |
|--------|-------------|-----|-----------|
| Migration 006 SQL Editor Supabase | Dev/PO | D-3-007 | OUI — avant deploy |
| DISABLE_REDIS=false Dokploy | Dev/PO | D-039, TNJ-K3-01 | OUI — sprint 3 mort sinon |
| QR_ENCRYPTION_KEY presente | Dev/PO | D-017, TNJ-K3-02 | OUI — QR scan impossible sinon |
| Cache-Control + X-Robots-Tag /ouvrier/no-affectation | Dev | TNJ-K3-06, K3-OQ-01 | OUI — condition Kakashi pour base64 |
| Smoke QR scan sur device mobile | Dev/PO | CLAUDE.md regle validation sprint | OUI — sprint ne peut pas etre valide sinon |
| Smoke DELETE affectation session invalide | Dev | TST-K3-10 | OUI (gap Levi) |

---

## Note post-deploy : Traefik access logs (optionnel, K3-LOW-06)

Verifier si Traefik enregistre les query strings dans les access logs (le param `data=<base64>` de `/ouvrier/no-affectation` pourrait y figurer). Commande de verification :

```bash
ssh -i C:\Users\Tuan\.ssh\ssh-149.202.57.242 ubuntu@149.202.57.242 -p 50000
sudo docker service logs dokploy --tail 50 2>&1 | grep "no-affectation"
```

Si les query strings apparaissent : configurer Traefik `accesslog.fields.headers.defaultmode = drop` ou ajouter un filtre regex. Non-bloquant Sprint 3 (K3-LOW-06).
