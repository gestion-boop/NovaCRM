-- Messages programmés multimédias : prise en charge des photos et vidéos
-- Décode le corps JSON s'il s'agit d'un message multimédia (__media__: true)

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
  is_media    boolean;
  media_kind  text;
  media_text  text;
  media_url   text;
  media_mime  text;
begin
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

      is_media := (m.body is not null and left(m.body, 17) = '{"__media__":true');
      if is_media then
        begin
          media_kind := coalesce(m.body::jsonb->>'kind', m.kind, 'text');
          media_text := coalesce(m.body::jsonb->>'text', '');
          media_url  := m.body::jsonb->>'attachmentUrl';
          media_mime := m.body::jsonb->>'attachmentMime';
        exception when others then
          is_media := false;
          media_kind := coalesce(m.kind, 'text');
          media_text := coalesce(m.body, '');
          media_url := null;
          media_mime := null;
        end;
      else
        media_kind := coalesce(m.kind, 'text');
        media_text := coalesce(m.body, '');
        media_url := null;
        media_mime := null;
      end if;

      if m.conversation_id is not null then
        if is_media and media_url is not null then
          insert into public.messages (conversation_id, user_id, kind, body, attachment_url, attachment_mime)
          values (m.conversation_id, m.user_id, media_kind, media_text, media_url, media_mime)
          returning id into nouvel_id;
        else
          insert into public.messages (conversation_id, user_id, kind, body)
          values (m.conversation_id, m.user_id, 'text', media_text)
          returning id into nouvel_id;
        end if;

        update public.conversations
           set last_message_at = now()
         where id = m.conversation_id;

      elsif m.channel_id is not null then
        nouvel_id := gen_random_uuid();

        execute format(
          'insert into public.chat_messages (id, channel, sender_id, is_deleted, read_by, data)
             values ($1, $2, $3, false, %L, %L)',
          jsonb_build_array(jsonb_build_object(
            'userId', m.user_id, 'userName', nom, 'readAt', now()
          ))::text,
          jsonb_build_object(
            'body', media_text,
            'kind', media_kind,
            'attachmentUrl', media_url,
            'attachment_url', media_url,
            'attachmentMime', media_mime,
            'sender_id', m.user_id,
            'sender_name', nom,
            'created_at', now()
          )::text
        )
        using nouvel_id, m.channel_id, m.user_id;

        update public.chat_channels
           set last_message_at = now()
         where id = m.channel_id;

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
              _message     => left(nom || ' : ' || coalesce(nullif(media_text, ''), case when media_kind = 'image' then '📷 Photo' when media_kind = 'video' then '🎥 Vidéo' else 'Message' end), 180),
              _entity_type => 'chat_message',
              _entity_id   => nouvel_id,
              _agency_id   => agence,
              _metadata    => jsonb_build_object('url', '/messagerie')
            );
          exception when others then
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
end;
$fonction$;
