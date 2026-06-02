# Configuration cookie session ouvrier — ouvrier_session
*Produit : 2026-06-02 | Tanjiro | Sprint 3 ClawBTP*
*Ref. architecturale : D-3-003, D-3-013, D-3-021 | Ref. securite : K3-S-03, K3-LOW-02, K3-LOW-05*

Ce document decrit les attributs du cookie `ouvrier_session`, les raisons de chaque choix, et les commandes de verification en prod.

---

## Attributs du cookie (specification binding)

| Attribut | Valeur prod | Valeur dev | Justification |
|----------|-------------|------------|---------------|
| **Nom** | `ouvrier_session` | `ouvrier_session` | Identifiant clair, distinct des cookies Supabase (`sb-*`) |
| **Valeur** | UUID v4 (`crypto.randomUUID()`) | UUID v4 | SessionId aleatoire 128 bits — non forgeable sans acces Redis |
| **Domain** | `saas-gestion-chantier.tanren-studio.com` | `localhost` | Implicite si non specifie — le navigateur scoped automatiquement |
| **Path** | `/` | `/` | DOIT etre `/` — voir note Path ci-dessous (D-3-021) |
| **HttpOnly** | `true` | `true` | Protege contre XSS `document.cookie` (K3-S-03) |
| **Secure** | `true` | `false` | HTTPS only en prod. En dev local (`http://localhost`), `Secure=false` est necessaire |
| **SameSite** | `Lax` | `Lax` | Permet GET top-level cross-site (scan QR iOS Camera App) — bloque POST cross-site (K3-LOW-05) |
| **Max-Age** | `604800` (7 jours en secondes) | `604800` | TTL session sliding window D-051/PO-005 |
| **Expires** | Non utilise | Non utilise | Max-Age prime sur Expires — utiliser Max-Age uniquement |

---

## Note critique — Path=/ obligatoire (D-3-021)

Le cookie DOIT avoir `Path=/` et non `Path=/ouvrier`.

**Pourquoi** : le middleware Next.js Edge matcher couvre `/ouvrier/*` ET `/api/ouvrier/*`. Le cookie doit etre transmis par le navigateur sur les deux prefixes. Avec `Path=/ouvrier`, les requetes vers `/api/ouvrier/*` n'enverraient PAS le cookie — le middleware detecterait "cookie absent" et retournerait 401 sur toutes les requetes API ouvrier.

**Securite** : le cookie `Path=/` est visible par toutes les routes Next.js, y compris `/admin/*` et `/conducteur/*`. Ce n'est pas un risque : HttpOnly empeche JS de le lire, et aucun handler admin/conducteur ne consomme `cookies().get('ouvrier_session')`. Le middleware Supabase Auth (admin/conducteur) utilise les cookies `sb-*` — orthogonaux. Ref K3-LOW-02.

---

## SameSite=Lax — justification anti-refus QR scan (K3-LOW-05)

Le scan QR depuis l'application Camera native iOS ou Android provoque une navigation top-level GET depuis une "origine" consideree cross-site par le navigateur (l'app Camera n'a pas d'origine HTTP). `SameSite=Strict` bloquerait l'envoi du cookie sur cette navigation top-level, cassant le flow de session apres le premier scan.

`SameSite=Lax` :
- Envoie le cookie sur GET top-level cross-site (scan QR, lien clique dans SMS)
- BLOQUE l'envoi sur POST/PATCH/DELETE cross-site (protection CSRF sur les mutations)

Les endpoints `/api/ouvrier/*` qui mutent (PATCH taches) sont appeles en fetch depuis le contexte same-origin de la PWA — SameSite=Lax ne les affecte pas.

---

## Implementation cote code Next.js 15

Le cookie est pose dans `app/api/auth/qr/[token]/route.ts` (handler scan QR, D-3-009). Extrait du pattern d'implementation binding :

```typescript
// Dans GET /api/auth/qr/[token]/route.ts — D-3-009 BINDING
// Pose du cookie apres creation session Redis reussie

const sessionId = crypto.randomUUID()

// Creer la session Redis (SETEX ouvrier_session:{sessionId} 604800 {json})
await redis.setex(`ouvrier_session:${sessionId}`, 604800, JSON.stringify(sessionData))
await redis.sadd(`ouvrier_user_sessions:${session.user_id}`, sessionId)
await redis.expire(`ouvrier_user_sessions:${session.user_id}`, 604800)

// Construire la response avec cookie
const response = NextResponse.redirect(redirectUrl)
response.cookies.set('ouvrier_session', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',  // false en dev local
  sameSite: 'lax',
  path: '/',                 // D-3-021 BINDING — PAS '/ouvrier'
  maxAge: 604800,            // 7 jours en secondes
})
return response
```

**Point d'attention Next.js 15** : `response.cookies.set()` fonctionne sur un `NextResponse` construit en amont (pattern D-032). Ne pas utiliser `cookieStore.set()` (n'ecrit pas sur une NextResponse manuelle).

---

## Verification en prod apres scan QR

Apres un scan QR valide, verifier que le cookie est bien pose avec tous les attributs corrects.

**Commande curl avec verbose headers** :

```
curl -sI -L "https://saas-gestion-chantier.tanren-studio.com/api/auth/qr/[TOKEN_VALIDE]"
```

Remplacer `[TOKEN_VALIDE]` par un token QR chiffre reel (genere via `/api/users/[id]/qr`).

Chercher dans la reponse la ligne `Set-Cookie`. Exemple de reponse attendue :

```
Set-Cookie: ouvrier_session=550e8400-e29b-41d4-a716-446655440000; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
```

Chaque attribut DOIT etre present :
- `Path=/` — pas `/ouvrier`
- `HttpOnly`
- `Secure` (uniquement en prod HTTPS)
- `SameSite=Lax`
- `Max-Age=604800`

Si un attribut manque : le code dans `app/api/auth/qr/[token]/route.ts` ne respecte pas D-3-003 — corriger avant smoke prod.

---

## Verification par test Vitest (TST-K3-17)

Le test `tests/unit/ouvrier-qr-handler.test.ts` (produit par Amelia Sprint 3) contient une assertion sur les attributs du cookie :

```typescript
// Extrait du test TST-K3-17
const setCookieHeader = response.headers.get('Set-Cookie')
expect(setCookieHeader).toContain('ouvrier_session=')
expect(setCookieHeader).toContain('Path=/')
expect(setCookieHeader).toContain('HttpOnly')
expect(setCookieHeader).toContain('SameSite=Lax')
expect(setCookieHeader).toContain('Max-Age=604800')
// Note : 'Secure' est teste uniquement si NODE_ENV=production
```

Ce test est dans la suite vitest Sprint 3 — il fait partie des 149 tests passes.

---

## Sliding window TTL — comment ca marche

A chaque requete authentifiee sur `/api/ouvrier/*`, le helper `lib/ouvrier-session.ts` (D-3-002) execute :

```typescript
// Dans getOuvrierSession()
await redis.expire(`ouvrier_session:${sessionId}`, 604800)
// TTL renouvele a 7j a chaque action ouvrier
```

Le cookie `Max-Age=604800` est pose une seule fois au scan QR. Il ne se renouvelle pas automatiquement cote navigateur. Mais le TTL Redis se renouvelle a chaque action.

**Consequence pratique** : un ouvrier actif quotidiennement ne sera jamais force a rescanner son QR. La session navigateur (Max-Age) et la session Redis expirent toutes les deux a 7j apres la DERNIERE action, pas apres le scan initial.

**Cas edge** : si l'ouvrier n'a pas utilise l'app pendant exactement 7j, les deux TTL expirent simultanement. L'ouvrier arrive sur `/ouvrier/*` avec un cookie present mais la cle Redis est inexistante — le helper retourne null — 401 — redirect `/ouvrier/scan`. Comportement correct.

---

## Variables d'environnement liees (reference)

Aucune nouvelle variable d'environnement n'est requise pour le cookie Sprint 3. Les variables existantes suffisent :

| Variable | Role | Ou la definir |
|----------|------|---------------|
| `REDIS_URL` | Stockage des sessions `ouvrier_session:{uuid}` | Dokploy > Environment |
| `DISABLE_REDIS` | Kill switch ioredis (D-039) — DOIT etre `false` ou absent | Dokploy > Environment |
| `QR_ENCRYPTION_KEY` | Dechiffrement du token QR pour creer la session | Dokploy > Environment |

Ref : D-017, D-039, TNJ-K3-01, TNJ-K3-02.
