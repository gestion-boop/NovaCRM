-- Envoi différé : la base délivre elle-même les messages programmés.
--
-- Signalé deux fois : « le message différé ne part pas ».
--
-- Cause de fond : la livraison passait par la fonction Edge
-- `run-automations`, qui n'est appelée que par un service EXTERNE
-- (cron-job.org, GitHub Actions…) via /api/automations/trigger, parce que le
-- forfait Vercel ne permet qu'un seul passage par jour. Rien dans le dépôt ne
-- configure ce service : s'il n'existe pas, ou s'il s'est arrêté, aucun
-- message programmé ne part jamais — sans la moindre erreur nulle part. Une
-- dépendance invisible, invérifiable depuis l'application.
--
-- Or tout ce que fait la livraison est du SQL : insérer une ligne dans
-- `messages` ou `chat_messages`, toucher `last_message_at`, notifier via
-- `create_notification`. Aucun besoin de Deno, de jeton Google ni d'HTTP.
-- On la remet donc dans la base, où elle n'a besoin de personne.
--
-- Deux usages, indépendants l'un de l'autre :
--   • à la main, pour vérifier ou débloquer tout de suite :
--       select public.envoyer_messages_programmes();
--     (renvoie le nombre de messages partis)
--   • automatiquement, par pg_cron — deuxième bloc, facultatif.
--
-- La fonction Edge continue de fonctionner si le service externe existe :
-- les deux ne peuvent pas envoyer deux fois le même message (verrou de ligne
-- + passage à `sent` dans la même transaction).

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
              _entity_type => 'chat_channel',
              _entity_id   => m.channel_id,
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

comment on function public.envoyer_messages_programmes() is
  'Envoie les messages programmés arrivés à échéance. Appelable à la main ou par pg_cron.';

revoke all on function public.envoyer_messages_programmes() from public;
grant execute on function public.envoyer_messages_programmes() to authenticated, service_role;
