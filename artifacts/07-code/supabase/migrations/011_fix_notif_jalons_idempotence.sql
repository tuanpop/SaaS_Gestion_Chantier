-- Migration 011 : fix idempotence du cron jalons (doublons après lecture)
-- Fichier : supabase/migrations/011_fix_notif_jalons_idempotence.sql
--
-- Retour smoke prod 2026-06-09 : re-jouer public.notif_jalons_cron() recréait des
-- notifications déjà émises une fois qu'elles avaient été lues. Cause : le NOT EXISTS
-- filtrait `n.lu = false`, donc une alerte lue n'était plus détectée comme existante.
--
-- Pour une alerte DATE-BASED (condition persistante "chantier/tâche en retard"), la bonne
-- sémantique d'idempotence = UNE seule notif par (user, type, chantier|tache) tant que la
-- condition persiste, INDÉPENDAMMENT de l'état lu. On retire donc `AND n.lu = false` des
-- deux NOT EXISTS. (Les notifs event-based — assignation/statut/dérive — gardent leur
-- idempotence sur lu=false dans le helper TS insertNotification : comportement voulu, un
-- nouvel événement après lecture doit re-notifier.)
--
-- Idempotente : CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.notif_jalons_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  today date := CURRENT_DATE;
BEGIN
  -- ---- Événement 4a : chantiers actifs dont date_fin_prevue < today ----
  INSERT INTO public.notifications (
    organisation_id, user_id, type, titre, message, chantier_id
  )
  SELECT
    c.organisation_id,
    u.id AS user_id,
    'echeance_chantier'::public.notification_type,
    'Chantier en retard : ' || public.sql_html_escape(c.nom),
    'La date de fin prévue du chantier « ' || public.sql_html_escape(c.nom) || ' » est dépassée depuis le ' || c.date_fin_prevue::text || '.',
    c.id AS chantier_id
  FROM public.chantiers c
  JOIN public.users u
    ON u.organisation_id = c.organisation_id
    AND u.role IN ('admin', 'conducteur')
    AND u.deleted_at IS NULL
  WHERE c.statut = 'actif'
    AND c.date_fin_prevue < today
  -- Idempotence : une seule notif par (user, type, chantier) — peu importe lu (fix 011)
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = u.id
      AND n.type = 'echeance_chantier'
      AND n.chantier_id = c.id
  );

  -- ---- Événement 4b : tâches actives dont date_echeance < today ----
  INSERT INTO public.notifications (
    organisation_id, user_id, type, titre, message, chantier_id, tache_id
  )
  SELECT
    t.organisation_id,
    u.id AS user_id,
    'echeance_tache'::public.notification_type,
    'Échéance dépassée : ' || public.sql_html_escape(t.titre),
    'La tâche « ' || public.sql_html_escape(t.titre) || ' » sur le chantier « ' || public.sql_html_escape(c.nom) || ' » a dépassé son échéance du ' || t.date_echeance::text || '.',
    t.chantier_id,
    t.id AS tache_id
  FROM public.taches t
  JOIN public.chantiers c ON c.id = t.chantier_id AND c.statut = 'actif'
  JOIN (
    SELECT DISTINCT ON (a.chantier_id) a.chantier_id, a.user_id
    FROM public.affectations a
    JOIN public.users u2 ON u2.id = a.user_id AND u2.role = 'conducteur' AND u2.deleted_at IS NULL
    ORDER BY a.chantier_id, a.created_at ASC
  ) cond ON cond.chantier_id = t.chantier_id
  JOIN public.users u ON u.id = cond.user_id
  WHERE t.date_echeance IS NOT NULL
    AND t.date_echeance < today
    AND t.statut NOT IN ('termine')
  -- Idempotence : une seule notif par (user, type, tache) — peu importe lu (fix 011)
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = u.id
      AND n.type = 'echeance_tache'
      AND n.tache_id = t.id
  );
END;
$$;
