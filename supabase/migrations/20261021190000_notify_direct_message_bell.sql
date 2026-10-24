-- Un message direct prévenait le téléphone (invoke_send_push) mais
-- n'écrivait rien dans `notifications`. La cloche et le toast dans le CRM
-- ne voyaient donc le message qu'au prochain sondage, ou pas du tout, alors
-- que le push, lui, passe par une file d'attente. La ligne est créée dans
-- la même transaction que le message : la cloche bouge dès l'enregistrement.
create or replace function public.notify_new_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _author_name text;
  _recipients uuid[];
  _recipient uuid;
  _preview text;
  _title text;
  _url text := '/messagerie';
  _channel_name text;
  _project_id uuid;
  _agency_id uuid;
  _lead_id uuid;
begin
  select coalesce(nullif(full_name, ''), email, 'Quelqu''un')
    into _author_name
    from public.profiles
   where id = new.user_id;

  _preview := case
    when new.kind::text = 'text' then coalesce(left(new.body, 140), '')
    when new.kind::text = 'audio' then '🎤 Message vocal'
    when new.kind::text = 'image' then '🖼️ Image'
    when new.kind::text = 'file'  then '📎 Fichier'
    else coalesce(left(new.body, 140), 'Nouveau message')
  end;

  if new.conversation_id is not null then
    select array_agg(distinct cm.user_id)
      into _recipients
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id
       and cm.user_id <> new.user_id;
    _title := _author_name;

    select lc.lead_id into _lead_id
      from public.lead_conversations lc
     where lc.conversation_id = new.conversation_id;

    if _lead_id is not null then
      _url := '/clients/' || _lead_id::text || '?tab=lead-chat&highlight_message=' || new.id::text;
    else
      _url := '/messagerie?conversation=' || new.conversation_id::text || '&message=' || new.id::text;
    end if;

  elsif new.channel_id is not null then
    select ch.name, ch.project_id, pr.agency_id
      into _channel_name, _project_id, _agency_id
      from public.chat_channels ch
      join public.chat_projects pr on pr.id = ch.project_id
     where ch.id = new.channel_id;

    _url := '/messagerie?channel=' || new.channel_id::text || '&message=' || new.id::text;
    _title := _author_name || ' · #' || coalesce(_channel_name, 'canal');

    _recipients := array(
      select distinct m.user_id
        from public.chat_project_members m
       where m.project_id = _project_id
         and m.user_id <> new.user_id
         and (
           _agency_id is null
           or exists (
             select 1 from public.agency_members am
              where am.user_id = m.user_id
                and am.agency_id = _agency_id
           )
         )
    );
  end if;

  if _recipients is not null and array_length(_recipients, 1) > 0 then
    foreach _recipient in array _recipients loop
      begin
        insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id)
        values (_recipient, 'message', coalesce(_title, 'Nouveau message'), _preview, _url, 'message', new.id);
      exception
        when unique_violation then
          update public.notifications
             set title = coalesce(_title, title),
                 body = _preview,
                 link = _url,
                 created_at = now(),
                 is_read = false
           where user_id = _recipient
             and type = 'message'
             and entity_id = new.id
             and dismissed_at is null;
        when others then
          null;
      end;
    end loop;

    begin
      perform public.invoke_send_push(
        _recipients,
        coalesce(_title, 'Nouveau message'),
        _preview,
        _url,
        'msg-' || new.id::text,
        new.conversation_id,
        _lead_id
      );
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$function$;
