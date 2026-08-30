-- Signalé : chaque déploiement de test envoyait une vraie notification push
-- au téléphone de l'utilisateur connecté (Sylvain), en plus du bandeau
-- discret "Mise à jour disponible" dans l'app — create_notification()
-- déclenche invoke_send_push() pour tous les types SAUF "daily_summary".
-- On exclut désormais aussi "app_update" : le bandeau/la clochette restent,
-- mais plus de notification système sur le téléphone pour un déploiement.

create or replace function public.create_notification(
  _user_id uuid,
  _type text,
  _title text,
  _message text,
  _entity_type text,
  _entity_id uuid,
  _agency_id uuid,
  _metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _id uuid;
  _url text := coalesce(_metadata->>'url', '/');
begin
  if _user_id is null then return null; end if;

  begin
    insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, agency_id, is_read, created_at)
    values (_user_id, _type, _title, _message, _url, _entity_type, _entity_id, _agency_id, false, now())
    returning id into _id;
  exception when unique_violation then
    update public.notifications
       set title = _title, body = _message, link = _url, created_at = now(), is_read = false
     where user_id = _user_id and type = _type and entity_id = _entity_id and dismissed_at is null
     returning id into _id;
  end;

  if _id is not null and _type not in ('daily_summary', 'app_update') then
    begin
      perform public.invoke_send_push(array[_user_id], _title, coalesce(_message, ''), _url, _type || '-' || _id::text);
    exception when others then null;
    end;
  end if;

  return _id;
end;
$function$;

create or replace function public.create_notification(
  _user_id uuid,
  _type text,
  _title text,
  _body text,
  _link text,
  _entity_type text,
  _entity_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _id uuid;
begin
  if _user_id is null then return null; end if;
  begin
    insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id)
    values (_user_id, _type, _title, _body, _link, _entity_type, _entity_id)
    returning id into _id;
  exception when unique_violation then
    update public.notifications
       set title = _title, body = _body, link = _link, created_at = now(), read_at = null
     where user_id = _user_id and type = _type and entity_id = _entity_id and dismissed_at is null
     returning id into _id;
  end;
  if _id is not null and _type not in ('daily_summary', 'app_update') then
    begin
      perform public.invoke_send_push(array[_user_id], _title, coalesce(_body, ''), coalesce(_link, '/'), _type || '-' || _id::text);
    exception when others then null;
    end;
  end if;
  return _id;
end;
$function$;
