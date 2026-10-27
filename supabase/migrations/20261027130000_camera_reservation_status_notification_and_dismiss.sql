-- Migration : Notifications de réservation caméra et nettoyage automatique de la barre
-- Quand une réservation caméra est validée ou refusée :
-- 1. La notification de demande en attente est automatiquement masquée/supprimée de la barre des approbateurs.
-- 2. Le demandeur reçoit une notification push & in-app indiquant clairement l'état (acceptée ou refusée).

-- Fonction RPC appelable par l'application pour masquer la demande chez tous les approbateurs
CREATE OR REPLACE FUNCTION public.dismiss_camera_reservation_notifications(_reservation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _reservation_id IS NULL THEN RETURN; END IF;
  UPDATE public.notifications
     SET dismissed_at = now(),
         is_read = true
   WHERE entity_type = 'camera_reservation'
     AND entity_id = _reservation_id
     AND type = 'camera_reservation_request'
     AND dismissed_at IS NULL;
END;
$$;

-- Fonction déclencheur appelée à chaque changement de statut (accepted / refused)
CREATE OR REPLACE FUNCTION public.notify_camera_reservation_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    title_text := '✅ Réservation caméra acceptée';
    body_text  := 'Votre réservation du ' || date_local || ' (' || start_local || '–' || end_local || ') a été acceptée.';
  ELSE
    title_text := '❌ Réservation caméra refusée';
    body_text  := 'Votre réservation du ' || date_local || ' (' || start_local || '–' || end_local || ') a été refusée'
                  || COALESCE(' : ' || NEW.refusal_reason, '') || '.';
  END IF;

  -- 1. Notification in-app au demandeur
  INSERT INTO public.notifications (user_id, type, title, body, link, entity_type, entity_id, agency_id, is_read, created_at)
  VALUES (
    NEW.user_id,
    'camera_reservation_' || NEW.status,
    title_text,
    body_text,
    '/reserver-camera',
    'camera_reservation',
    NEW.id,
    NEW.agency_id,
    false,
    now()
  )
  ON CONFLICT DO NOTHING;

  -- 2. Nettoyage de la barre de notifications : masquage de la demande d'origine pour tous les approbateurs
  UPDATE public.notifications
     SET dismissed_at = now(),
         is_read = true
   WHERE entity_type = 'camera_reservation'
     AND entity_id = NEW.id
     AND type = 'camera_reservation_request'
     AND dismissed_at IS NULL;

  -- 3. Notification push sur le téléphone du demandeur
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

-- Rétablissement du déclencheur sur camera_reservations
DROP TRIGGER IF EXISTS on_camera_reservation_status_changed ON public.camera_reservations;
CREATE TRIGGER on_camera_reservation_status_changed
  AFTER UPDATE OF status ON public.camera_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_camera_reservation_status_changed();

DROP TRIGGER IF EXISTS on_camera_reservation_created ON public.camera_reservations;
CREATE TRIGGER on_camera_reservation_created
  AFTER INSERT ON public.camera_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_camera_reservation_created();
