-- Signalé le 7 octobre : « quand on lit des messages sur le téléphone cela
-- ne se met pas à jour sur l'ordinateur et les autres supports, au final on
-- est perdu sur les notifications ».
--
-- Cause réelle (aucun rapport avec l'appareil, reproductible sur n'importe
-- quel support) : pour un message de CANAL (`chat_messages`), les trois
-- chemins qui créent la notification (ce trigger, `notifierMembresDuDossier`
-- côté application, et `envoyer_messages_programmes` pour les messages
-- différés) enregistraient `entity_id = <id du CANAL>`. Mais la lecture d'un
-- canal (`loadMessages`, ChatViewSupabase.tsx) marque lu par IDENTIFIANT DE
-- MESSAGE (`entity_id IN (...ids des messages lus)`). Les deux ne
-- correspondaient donc jamais : ce `.update(is_read = true)` ne touchait 0
-- ligne, indéfiniment, quel que soit l'appareil qui lit.
--
-- Même correctif déjà appliqué et validé pour `internal_task_message` (voir
-- useTaskMessages.ts) : l'entité est désormais le MESSAGE lui-même, pas son
-- conteneur. Conséquence acceptée (même choix que pour les tâches) : au lieu
-- d'un seul encart de cloche qui se réécrit pour tout le canal, chaque
-- message non lu obtient sa propre ligne — mais qui, cette fois, se marque
-- bien comme lue.
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
    VALUES (_recipient, 'message', _title, _preview, _link, 'chat_message', NEW.id);
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

-- Même correctif pour les messages de canal envoyés en différé (programmés),
-- qui passent par cette fonction plutôt que par le trigger ci-dessus.
create or replace function public.envoyer_messages_programmes()
returns integer
language plpgsql
security definer
set search_path = public
as $fonction$
declare
  m           record;
  nb          integer := 0;
  nom         text;
  nouvel_id   uuid;
  membre      record;
  nom_projet  text;
  nom_canal   text;
  agence      uuid;
begin
  -- `for update skip locked` : deux passages simultanés (le cron et un appel
  -- à la main, par exemple) ne peuvent pas prendre la même ligne, donc pas
  -- de message envoyé deux fois.
  for m in
    select *
      from public.scheduled_messages
     where status = 'pending'
       and scheduled_at <= now()
     order by scheduled_at
     limit 200
     for update skip locked
  loop
    begin
      select coalesce(p.full_name, p.email, 'Utilisateur')
        into nom
        from public.profiles p
       where p.id = m.user_id;
      nom := coalesce(nom, 'Utilisateur');

      if m.conversation_id is not null then
        -- Conversation directe : mêmes colonnes que sendConvMessage.
        insert into public.messages (conversation_id, user_id, kind, body)
        values (m.conversation_id, m.user_id, 'text', m.body)
        returning id into nouvel_id;

        update public.conversations
           set last_message_at = now()
         where id = m.conversation_id;
        -- Notification : le déclencheur existant sur `messages` s'en charge.

      elsif m.channel_id is not null then
        -- Canal de dossier : `chat_messages` a un contenu JSON libre. Les
        -- deux valeurs JSON sont passées en littéral non typé (format %L +
        -- execute) pour convenir que la colonne soit `json` ou `jsonb` —
        -- cette table n'étant suivie par aucune migration du dépôt, son type
        -- exact n'est pas connu d'ici.
        nouvel_id := gen_random_uuid();

        execute format(
          'insert into public.chat_messages (id, channel, sender_id, is_deleted, read_by, data)
             values ($1, $2, $3, false, %L, %L)',
          jsonb_build_array(jsonb_build_object(
            'userId', m.user_id, 'userName', nom, 'readAt', now()
          ))::text,
          jsonb_build_object(
            'body', m.body,
            'kind', 'text',
            'sender_id', m.user_id,
            'sender_name', nom,
            'created_at', now()
          )::text
        )
        using nouvel_id, m.channel_id, m.user_id;

        update public.chat_channels
           set last_message_at = now()
         where id = m.channel_id;

        -- Notification des membres du dossier : aucun déclencheur n'existe
        -- sur `chat_messages`, contrairement à `messages`. Même contenu que
        -- notifierMembresDuDossier côté application.
        select c.name, pr.name, pr.agency_id
          into nom_canal, nom_projet, agence
          from public.chat_channels c
          join public.chat_projects pr on pr.id = c.project_id
         where c.id = m.channel_id;

        for membre in
          select distinct pm.user_id
            from public.chat_project_members pm
            join public.chat_channels c on c.project_id = pm.project_id
           where c.id = m.channel_id
             and pm.user_id is not null
             and pm.user_id <> m.user_id
        loop
          begin
            perform public.create_notification(
              _user_id     => membre.user_id,
              _type        => 'message',
              _title       => left('💬 ' || coalesce(nom_projet, 'Projet interne') || ' · ' || coalesce(nom_canal, ''), 120),
              _message     => left(nom || ' : ' || m.body, 180),
              _entity_type => 'chat_message',
              _entity_id   => nouvel_id,
              _agency_id   => agence,
              _metadata    => jsonb_build_object('url', '/messagerie')
            );
          exception when others then
            -- Une notification qui échoue ne doit pas empêcher le message
            -- d'être considéré comme envoyé : il EST dans le canal.
            null;
          end;
        end loop;

      else
        raise exception 'Ni canal ni conversation renseigné.';
      end if;

      update public.scheduled_messages
         set status = 'sent', sent_at = now(), sent_message_id = nouvel_id
       where id = m.id;
      nb := nb + 1;

    exception when others then
      update public.scheduled_messages
         set status = 'failed', error = sqlerrm
       where id = m.id;
    end;
  end loop;

  return nb;
end
$fonction$;
