-- Signalé (7 septembre) : « on ne voit pas trop bien la date qui est
-- demandée » — en creusant, chaque demande de réservation caméra déclenchait
-- JUSQU'À 3 notifications identiques : deux déclencheurs base strictement
-- identiques (`on_camera_reservation_created` et `trg_camera_reservation_created`,
-- tous deux appelant `notify_camera_reservation_created()`), plus un appel
-- client redondant (CameraReservationModal.tsx). Même doublon pour le
-- changement de statut (`on_camera_reservation_status_changed` /
-- `trg_camera_reservation_status_changed`). En plus du bruit, le lien
-- envoyé (`/agenda?camera_reservation=<id>`) ne menait nulle part —
-- aucune route ne lisait ce paramètre — donc le clic sur la notification
-- n'ouvrait jamais la demande concernée.

drop trigger if exists on_camera_reservation_created on public.camera_reservations;
drop trigger if exists on_camera_reservation_status_changed on public.camera_reservations;

create or replace function public.notify_camera_reservation_created()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  requester_name   text;
  start_local      text;
  end_local        text;
  date_local       text;
  body_text        text;
  approver_ids     uuid[];
  v_project_url    text;
  v_internal_token text;
  push_payload     jsonb;
BEGIN
  SELECT COALESCE(NULLIF(p.full_name, ''), p.email, 'Un utilisateur')
    INTO requester_name
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  date_local  := to_char(NEW.start_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY');
  start_local := to_char(NEW.start_at AT TIME ZONE 'Europe/Paris', 'HH24:MI');
  end_local   := to_char(NEW.end_at   AT TIME ZONE 'Europe/Paris', 'HH24:MI');
  body_text := COALESCE(requester_name, 'Un utilisateur')
               || ' souhaite réserver du matériel pour le ' || date_local
               || ' de ' || start_local || ' à ' || end_local || '.';

  SELECT array_agg(DISTINCT u) INTO approver_ids
    FROM (SELECT user_id AS u FROM public.camera_reservation_approvers()) s
   WHERE u IS NOT NULL AND u <> NEW.user_id;

  IF approver_ids IS NOT NULL AND array_length(approver_ids, 1) > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, entity_type, entity_id, agency_id)
    SELECT unnest(approver_ids),
           'camera_reservation_request',
           'Nouvelle demande de réservation caméra',
           body_text,
           '/reserver-camera',
           'camera_reservation',
           NEW.id,
           NEW.agency_id
    ON CONFLICT DO NOTHING;

    SELECT s.project_url, s.internal_token
      INTO v_project_url, v_internal_token
      FROM public.app_settings s WHERE s.id = 1;

    IF v_project_url IS NOT NULL AND v_internal_token IS NOT NULL AND v_internal_token <> '' THEN
      push_payload := jsonb_build_object(
        'user_ids',  to_jsonb(approver_ids),
        'title',     'Nouvelle demande de réservation caméra',
        'message',   body_text,
        'url',       '/reserver-camera',
        'tag',       'camera-reservation-' || NEW.id::text
      );
      BEGIN
        PERFORM net.http_post(
          url     := v_project_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',     'application/json',
            'x-internal-token', v_internal_token
          ),
          body := push_payload
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

create or replace function public.notify_camera_reservation_rescheduled()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  requester_name   text;
  date_local       text;
  start_local      text;
  end_local        text;
  body_text        text;
  approver_ids     uuid[];
  v_project_url    text;
  v_internal_token text;
  push_payload     jsonb;
BEGIN
  IF (NEW.start_at = OLD.start_at AND NEW.end_at = OLD.end_at) THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(p.full_name, ''), p.email, 'Un utilisateur')
    INTO requester_name
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  date_local  := to_char(NEW.start_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY');
  start_local := to_char(NEW.start_at AT TIME ZONE 'Europe/Paris', 'HH24:MI');
  end_local   := to_char(NEW.end_at   AT TIME ZONE 'Europe/Paris', 'HH24:MI');
  body_text := COALESCE(requester_name, 'Un utilisateur')
               || ' a modifié sa demande de réservation pour le ' || date_local
               || ' de ' || start_local || ' à ' || end_local || '.';

  SELECT array_agg(DISTINCT u) INTO approver_ids
    FROM (SELECT user_id AS u FROM public.camera_reservation_approvers()) s
   WHERE u IS NOT NULL AND u <> NEW.user_id;

  IF approver_ids IS NOT NULL AND array_length(approver_ids, 1) > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, entity_type, entity_id, agency_id)
    SELECT unnest(approver_ids),
           'camera_reservation_request',
           'Demande de réservation caméra modifiée',
           body_text,
           '/reserver-camera',
           'camera_reservation',
           NEW.id,
           NEW.agency_id
    ON CONFLICT DO NOTHING;

    SELECT s.project_url, s.internal_token
      INTO v_project_url, v_internal_token
      FROM public.app_settings s WHERE s.id = 1;

    IF v_project_url IS NOT NULL AND v_internal_token IS NOT NULL AND v_internal_token <> '' THEN
      push_payload := jsonb_build_object(
        'user_ids', to_jsonb(approver_ids),
        'title',    'Demande de réservation caméra modifiée',
        'message',  body_text,
        'url',      '/reserver-camera',
        'tag',      'camera-reservation-' || NEW.id::text
      );
      BEGIN
        PERFORM net.http_post(
          url     := v_project_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',     'application/json',
            'x-internal-token', v_internal_token
          ),
          body := push_payload
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

create or replace function public.notify_camera_reservation_status_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  date_local       text;
  start_local      text;
  end_local        text;
  title_text       text;
  body_text        text;
  v_project_url    text;
  v_internal_token text;
  push_payload     jsonb;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('accepted', 'refused') THEN RETURN NEW; END IF;

  date_local  := to_char(NEW.start_at AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY');
  start_local := to_char(NEW.start_at AT TIME ZONE 'Europe/Paris', 'HH24:MI');
  end_local   := to_char(NEW.end_at   AT TIME ZONE 'Europe/Paris', 'HH24:MI');

  IF NEW.status = 'accepted' THEN
    title_text := 'Réservation caméra acceptée';
    body_text  := 'Votre réservation du ' || date_local || ' (' || start_local || '–' || end_local || ') a été acceptée.';
  ELSE
    title_text := 'Réservation caméra refusée';
    body_text  := 'Votre réservation du ' || date_local || ' (' || start_local || '–' || end_local || ') a été refusée'
                  || COALESCE(' : ' || NEW.refusal_reason, '') || '.';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link, entity_type, entity_id, agency_id)
  VALUES (
    NEW.user_id,
    'camera_reservation_' || NEW.status,
    title_text,
    body_text,
    '/reserver-camera',
    'camera_reservation',
    NEW.id,
    NEW.agency_id
  )
  ON CONFLICT DO NOTHING;

  SELECT s.project_url, s.internal_token
    INTO v_project_url, v_internal_token
    FROM public.app_settings s WHERE s.id = 1;

  IF v_project_url IS NOT NULL AND v_internal_token IS NOT NULL AND v_internal_token <> '' THEN
    push_payload := jsonb_build_object(
      'user_ids', to_jsonb(ARRAY[NEW.user_id]),
      'title',    title_text,
      'message',  body_text,
      'url',      '/reserver-camera',
      'tag',      'camera-reservation-' || NEW.id::text
    );
    BEGIN
      PERFORM net.http_post(
        url     := v_project_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type',     'application/json',
          'x-internal-token', v_internal_token
        ),
        body := push_payload
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
