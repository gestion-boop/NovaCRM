-- Signalé (10 septembre, Sylvain) : "j'ai envoyé un message de moi mais
-- cela n'aboutit pas au message en cliquant sur la notification" — le clic
-- sur une notification push de conversation directe.
--
-- Trouvé en relisant notify_new_message() (déclencheur sur `messages`,
-- insertion) : l'appel à invoke_send_push() ne passait QUE 5 arguments
-- (title/message/url/tag), jamais les 6e/7e paramètres _conversation_id et
-- _lead_id — pourtant prévus par la fonction (voir migration
-- 20260909220000, qui a justement supprimé l'ancienne version à 5
-- paramètres au profit de celle à 7). L'URL elle-même contenait déjà
-- ?conversation=<id>&message=<id> en texte, mais deux mécanismes CÔTÉ
-- SERVICE WORKER dépendent de `data.conversation_id`, pas de l'URL :
--
-- 1. isFocusedOnContext (réception du push, public/sw.js) : censé ne PAS
--    afficher de bannière si l'utilisateur regarde déjà cette conversation
--    précise — ne pouvait jamais matcher pour une conversation directe.
-- 2. notificationclick (public/sw.js) : censé fermer automatiquement
--    toutes les AUTRES notifications de la même conversation dès qu'on
--    clique sur l'une d'elles — ne pouvait matcher que par tag exact (un
--    tag unique par message), donc une rafale de messages sur la même
--    conversation s'empilait dans la barre Android au lieu de se
--    regrouper, avec un risque de cliquer sur une notification "périmée"
--    dont le focus()/navigate() du client existant échoue silencieusement
--    (cas déjà documenté pour iOS/Safari standalone dans public/sw.js).
--
-- Corrigé : NEW.conversation_id et _lead_id transmis, comme le fait déjà
-- tg_chat_message_after_insert pour les canaux d'équipe.
create or replace function public.notify_new_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _author_name TEXT;
  _recipients UUID[];
  _preview TEXT;
  _title TEXT;
  _url TEXT := '/messagerie';
  _channel_name TEXT;
  _project_id UUID;
  _agency_id UUID;
  _lead_id UUID;
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
    perform public.invoke_send_push(
      _recipients,
      _title,
      _preview,
      _url,
      'msg-' || new.id::text,
      new.conversation_id,
      _lead_id
    );
  end if;

  return new;
end;
$function$;
