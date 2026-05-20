# Plan d'implémentation — Fix invitation_status pending→active
*Date: 2026-05-20 | Developer: Amelia | Sprint: Bug Sprint 2*

## Résumé

`public.users.invitation_status` ne transite jamais de `'pending'` à `'active'` après que
l'invité ait défini son mot de passe sur `/auth/invite`. Ce plan corrige le bug en trois
couches : un nouvel endpoint API server-side, une modification du client `/auth/invite`,
et un script SQL rétroactif manuel. En parallèle, la protection D-040 est renforcée avec
un discriminant secondaire fail-safe.

---

## Ordre d'exécution

1. `app/api/auth/complete-invite/route.ts` (nouveau fichier — aucune dépendance circulaire)
2. `app/auth/invite/page.tsx` (modification — appelle le nouvel endpoint)
3. `supabase/migrations/005_users_complete_invite_retroactive.sql` (script SQL — pas exécuté automatiquement)
4. `__tests__/api/auth/complete-invite.test.ts` (tests Vitest)

---

## Fichiers

### Fichier 1 — `app/api/auth/complete-invite/route.ts` (NOUVEAU)

Endpoint PATCH authentifié côté serveur. Lit l'identité depuis la session JWT via
`createClient()` (T-01 : user_id jamais depuis body). Fait un UPDATE ciblé :

```sql
UPDATE public.users
SET invitation_status = 'active'
WHERE id = <auth.uid()>
  AND invitation_status = 'pending'
```

Ownership implicite : la session est celle du user lui-même, le filtre `id = auth.uid()`
empêche tout update sur un autre user. Idempotent : le filtre `AND invitation_status =
'pending'` fait que si le statut est déjà `'active'`, la requête update 0 lignes sans
erreur — réponse 204 dans les deux cas.

**D-012 assertTrialActive** : non applicable ici. Complete-invite est un flow
d'authentification interne (finalisation de compte), pas une mutation business sur les
ressources de l'organisation. L'invité n'a pas encore accès à l'app — le bloquer via
trial gate serait incohérent et casserait l'onboarding. Justification documentée en
commentaire dans le fichier ET dans DECISIONLOG.md.

Pattern logger : `createRequestLogger(correlationId)` identique à la route reinvite.
Réponse : 204 No Content (succès ou idempotent), 401 si pas de session.

---

### Fichier 2 — `app/auth/invite/page.tsx` (MODIFICATION)

**Partie A — handleSubmit** : après `supabase.auth.updateUser({ password })` réussi,
appeler `fetch('/api/auth/complete-invite', { method: 'PATCH' })`. Ne pas faire échouer
le flow : si l'endpoint retourne une erreur, logger côté client (impossible sans
`lib/logger` en Client Component — utiliser `console.error` en fallback UNIQUEMENT pour
ce cas UI, annoté d'un commentaire explicatif) et afficher un toast d'avertissement
non-bloquant. Le `router.push('/')` se fait dans tous les cas.

**Partie B — Hardening D-040** : ajout d'un discriminant secondaire pour la détection
admin pré-existant vs nouvel invité.

Discriminant retenu : **`created_at` récent (< 5 minutes) côté `public.users`**.

Justification vs alternatives :
- `email_confirmed_at` (auth.users) : inaccessible depuis le client-side Supabase anon
  client sans appel API supplémentaire. Complexité accrue.
- `last_sign_in_at` (auth.users) : même problème d'accès depuis le client anon.
- `created_at` (public.users) : accessible via RLS (le user peut lire son propre row,
  déjà prouvé par le SELECT `invitation_status` existant). Un nouvel invité vient d'être
  créé — `created_at` < 5 min est un signal fort. Un admin pré-existant a forcément un
  `created_at` de plusieurs heures/jours.

Logique renforcée dans `checkSession()` :

```
if (role === 'admin') {
  SELECT invitation_status, created_at FROM public.users WHERE id = user.id

  const isRecentlyCreated = (Date.now() - new Date(created_at).getTime()) < 5 * 60 * 1000

  if (invitationStatus !== 'pending' || !isRecentlyCreated) {
    // Fail-safe : si l'UN OU L'AUTRE des discriminants échoue → bloquer
    setAdminBlocked(true)
  }
}
```

Fail-safe design : si `invitation_status` est cassé (reste 'pending' pour un ancien
admin), le discriminant `created_at` récent bloque quand même. Inversement si
`created_at` est ambigu (edge case extrêmement improbable), `invitation_status` bloque.
Les deux doivent être vrais pour laisser passer. Condition `&&` = fail-safe par défaut.

---

### Fichier 3 — `supabase/migrations/005_users_complete_invite_retroactive.sql` (NOUVEAU)

Script SQL idempotent, commenté, **à exécuter manuellement** via Supabase Dashboard
pour les users déjà connectés en prod dont `invitation_status` est resté 'pending'.

Critère de sélection : `last_sign_in_at IS NOT NULL` sur `auth.users` (Supabase le
remplit à chaque connexion — c'est le seul signal DB fiable côté serveur pour "s'est
déjà connecté"). Protégé par `has_supabase_auth = true` pour éviter les ouvriers sans
compte Auth.

---

### Fichier 4 — `__tests__/api/auth/complete-invite.test.ts` (NOUVEAU)

Tests Vitest avec mock `@/lib/supabase/server` et `next/headers`.

Cas couverts :
1. **Happy path** — session valide + `invitation_status = 'pending'` → UPDATE réussi → 204
2. **Auth required** — pas de session (`getUser` retourne null) → 401
3. **Idempotent** — session valide + `invitation_status = 'active'` (update 0 lignes) → 204
4. **Ownership impossible** — le filtre `id = user.id` est dans la requête server-side ;
   test vérifie que le `eq('id', user.id)` est appelé avec l'UID de session, jamais avec
   un paramètre externe
5. **DB error** — `supabase.from().update()` retourne une erreur → 500 avec log

---

## Checklist sécurité (Kakashi)

- [x] T-01 : user_id depuis JWT session uniquement, jamais body ni params
- [x] Ownership check implicite via `eq('id', user.id)` dans la requête
- [x] Auth check en premier dans le handler avant toute logique
- [x] Idempotence : filtre `AND invitation_status = 'pending'` empêche les updates parasites
- [x] Pas d'exposition de service role key (createClient anon avec RLS)
- [x] Logs structurés via createRequestLogger, aucun console.log en server-side
- [x] D-040 hardened : condition && entre deux discriminants indépendants (fail-safe)

---

## Points d'attention

- Le Client Component `/auth/invite/page.tsx` ne peut pas importer `lib/logger.ts` (pino
  ne tourne pas dans le browser). Le `console.error` du cas d'échec fetch est l'unique
  exception à la règle no-console — annoté explicitement.
- Après ce fix, les admins réinvités via `/api/users/[id]/reinvite` (qui reset à
  'pending') seront correctement remis à 'active' lors de leur prochaine activation. Le
  flow est cohérent end-to-end.
- Le script SQL migration 005 doit rester commenté dans son en-tête : il n'est PAS
  exécuté par `supabase db push` — c'est une application manuelle ponctuelle.
