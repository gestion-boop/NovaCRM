-- Signalé (17/09/2026, Réseaux sociaux/Immosphera) : « Laetitia a été
-- invitée dans le canal mais ne reçoit aucun message » + « il faut que les
-- admins, pas seulement les super admins, puissent inviter des
-- utilisateurs ».
--
-- Deux bugs distincts corrigés ici :
--
-- 1) La politique "Créateur ou admin invite au canal" (et son pendant pour
--    retirer un participant), malgré son nom, ne vérifiait JAMAIS le rôle
--    "admin" — seulement super_admin, le créateur du canal ou le créateur
--    du dossier. Un admin (non super admin, non créateur) ne pouvait donc
--    ni inviter ni retirer un participant d'un canal, contrairement à ce
--    que son nom promettait. On ajoute désormais explicitement le rôle
--    admin, à condition qu'il soit déjà membre du dossier concerné (pas de
--    quoi gérer un dossier auquel il n'a lui-même pas accès).
--
-- 2) `tg_chat_message_after_insert` (trigger de notification/push après un
--    message de canal) calcule ses destinataires UNIQUEMENT à partir de
--    `chat_project_members` (membres du DOSSIER), sans jamais tenir compte
--    de la restriction par CANAL introduite par can_view_chat_channel
--    (migration 20260916100000). Conséquence dans les deux sens :
--      - un membre invité à un canal restreint mais pas encore (ou plus)
--        listé dans chat_project_members ne reçoit RIEN, comme observé
--        pour Laetitia sur le canal "Laetitia" du dossier "Réseaux
--        sociaux" (5 messages envoyés, une seule notification produite) ;
--      - à l'inverse, un membre du dossier qui n'a PAS été invité à un
--        canal restreint reçoit quand même une notification/un push
--        révélant le nom du canal et un aperçu du message — fuite
--        d'information vers un canal qu'il ne peut pourtant pas ouvrir.
--    Le trigger applique désormais exactement le même filtre que les
--    politiques RLS des messages (chat_project_members ET
--    can_view_chat_channel).

drop policy if exists "Créateur ou admin invite au canal" on public.chat_channel_members;
create policy "Créateur ou admin invite au canal"
  on public.chat_channel_members for insert
  with check (
    has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      where ch.id = channel_id
        and (
          ch.created_by = auth.uid()
          or is_chat_project_creator(auth.uid(), ch.project_id)
          or (has_role(auth.uid(), 'admin'::app_role) and is_chat_project_member(auth.uid(), ch.project_id))
        )
    )
  );

drop policy if exists "Créateur ou admin retire du canal" on public.chat_channel_members;
create policy "Créateur ou admin retire du canal"
  on public.chat_channel_members for delete
  using (
    user_id = auth.uid()
    or has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      where ch.id = channel_id
        and (
          ch.created_by = auth.uid()
          or is_chat_project_creator(auth.uid(), ch.project_id)
          or (has_role(auth.uid(), 'admin'::app_role) and is_chat_project_member(auth.uid(), ch.project_id))
        )
    )
  );

create or replace function public.tg_chat_message_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  _author_name  text;
  _preview      text;
  _link         text;
  _channel_name text;
  _project_id   uuid;
  _channel_id   uuid;
  _recipient    uuid;
  _recipients   uuid[];
  _title        text;
  _author       uuid;
  _kind         text;
BEGIN
  _author := COALESCE(NEW.sender_id, (NEW.data->>'sender_id')::uuid);
  IF _author IS NULL OR NEW.channel IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name,''), email, 'Quelqu''un')
    INTO _author_name FROM public.profiles WHERE id = _author;

  _kind := COALESCE(NEW.data->>'kind', 'text');
  _preview := CASE
    WHEN _kind IN ('voice','audio') THEN 'Message vocal'
    WHEN _kind = 'image'            THEN 'Image'
    WHEN _kind = 'file'             THEN 'Fichier'
    ELSE COALESCE(LEFT(NEW.data->>'body', 140), 'Nouveau message')
  END;

  _channel_id := NEW.channel::uuid;
  SELECT name, project_id INTO _channel_name, _project_id
  FROM public.chat_channels WHERE id = _channel_id;

  _link  := '/messagerie?highlight=' || NEW.id::text;
  _title := COALESCE(_author_name, 'Message') || ' - #' || COALESCE(_channel_name, 'canal');

  -- Même filtre que les policies RLS des messages (voir migration
  -- 20260916100000) : membre du DOSSIER *et* autorisé à voir CE canal —
  -- sans quoi un canal restreint notifiait tout le dossier au lieu de ses
  -- seuls participants (et inversement, privait de notification un
  -- participant pas encore listé côté dossier).
  _recipients := ARRAY(
    SELECT DISTINCT m.user_id FROM public.chat_project_members m
    WHERE m.project_id = _project_id
      AND m.user_id <> _author
      AND public.can_view_chat_channel(m.user_id, _channel_id)
  );

  FOREACH _recipient IN ARRAY COALESCE(_recipients, ARRAY[]::uuid[]) LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link, entity_type, entity_id)
    VALUES (_recipient, 'message', _title, _preview, _link, 'channel', NEW.channel);
  END LOOP;

  IF array_length(_recipients, 1) > 0 THEN
    BEGIN
      PERFORM public.invoke_send_push(_recipients, _title, _preview, _link, 'msg-' || NEW.id::text);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tg_chat_message_after_insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
