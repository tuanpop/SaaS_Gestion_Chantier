-- ============================================================
-- Migration 005 — Rétroactivation invitation_status pending→active
-- ============================================================
--
-- ATTENTION : APPLICATION MANUELLE UNIQUEMENT
-- Ce script NE DOIT PAS être exécuté via `supabase db push` ou les outils
-- de migration automatique. Il est conçu pour une exécution ponctuelle via
-- le Supabase Dashboard → SQL Editor, une seule fois en production, pour
-- corriger les utilisateurs invités qui ont déjà défini leur mot de passe
-- mais dont invitation_status est resté 'pending' (bug corrigé par le
-- nouvel endpoint PATCH /api/auth/complete-invite).
--
-- Pré-requis avant exécution :
--   1. Le fix PATCH /api/auth/complete-invite est déployé en production.
--   2. Faire une sauvegarde ou noter le résultat de la requête SELECT ci-dessous.
--
-- Critère de sélection des users à corriger :
--   - public.users.invitation_status = 'pending'     → invite non finalisé selon DB
--   - auth.users.last_sign_in_at IS NOT NULL          → s'est déjà connecté au moins une fois
--     (Supabase remplit last_sign_in_at à chaque connexion — signal fiable "a activé son compte")
--   - public.users.has_supabase_auth = true           → a un compte Auth (exclut les ouvriers QR)
--   - public.users.deleted_at IS NULL                 → non supprimé (soft delete)
--
-- Idempotence : la condition WHERE garantit que ré-exécuter le script n'affecte
-- aucune ligne supplémentaire (les lignes déjà mises à 'active' ne matchent pas).
-- ============================================================

-- Étape 1 — AUDIT (exécuter d'abord en SELECT pour vérifier les lignes concernées)
-- Décommentez et exécutez cette partie AVANT le UPDATE pour valider le périmètre.
/*
SELECT
    u.id,
    u.email,
    u.nom,
    u.prenom,
    u.role,
    u.invitation_status,
    u.created_at,
    au.last_sign_in_at,
    u.organisation_id
FROM public.users u
JOIN auth.users au ON au.id = u.id
WHERE
    u.invitation_status = 'pending'
    AND u.has_supabase_auth = true
    AND u.deleted_at IS NULL
    AND au.last_sign_in_at IS NOT NULL
ORDER BY au.last_sign_in_at DESC;
*/

-- Étape 2 — CORRECTION (exécuter après validation de l'audit)
-- Met à jour invitation_status → 'active' pour tous les utilisateurs qui ont
-- déjà défini leur mot de passe (preuve : last_sign_in_at IS NOT NULL) mais
-- dont le statut est resté 'pending' à cause du bug.
UPDATE public.users u
SET
    invitation_status = 'active'
FROM auth.users au
WHERE
    au.id = u.id
    AND u.invitation_status = 'pending'
    AND u.has_supabase_auth = true
    AND u.deleted_at IS NULL
    AND au.last_sign_in_at IS NOT NULL;

-- Étape 3 — VÉRIFICATION (exécuter après le UPDATE)
/*
SELECT
    COUNT(*) AS total_updated,
    COUNT(*) FILTER (WHERE invitation_status = 'active') AS now_active,
    COUNT(*) FILTER (WHERE invitation_status = 'pending') AS still_pending
FROM public.users
WHERE
    has_supabase_auth = true
    AND deleted_at IS NULL;
*/
