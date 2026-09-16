-- Signalé (16 septembre, capture à l'appui) : « Isabelle voit les canaux
-- de Laetitia, Carine etc. et quand je mets un message dans le canal de
-- Laetitia, Isabelle reçoit également ce message-là alors qu'elle ne fait
-- pas partie du canal. Il faut cloisonner et conditionner ABSOLUMENT :
-- toute personne recevra un message si elle est invitée dans le canal, et
-- ne verrait pas les autres canaux si elle n'est pas invitée. »
--
-- Cause racine : la restriction (migration 20260916100000) dépendait d'une
-- case à cocher séparée (`chat_channels.restricted`), en plus d'inviter des
-- participants — 5 canaux Immosphera (Laetitia, Karine, Christophe,
-- Pauline, Isabelle) avaient bien des participants invités (chat_channel_members)
-- mais `restricted` était resté à false : la case avait été oubliée, et
-- rien ne les protégeait malgré des participants explicitement choisis.
--
-- Correctif : la restriction devient automatique et absolue, comme demandé.
-- Un canal est restreint dès qu'il a AU MOINS un participant dans
-- chat_channel_members — plus besoin (ni possibilité) de l'oublier. Un
-- canal sans aucun participant invité reste ouvert à tout le dossier,
-- comme avant. La colonne `restricted` n'est plus utilisée par cette
-- fonction (conservée en base sans effet, pour ne rien casser ailleurs).
create or replace function public.can_view_chat_channel(_user_id uuid, _channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    has_role(_user_id, 'super_admin'::app_role)
    or exists (select 1 from public.chat_channels c where c.id = _channel_id and c.created_by = _user_id)
    or not exists (select 1 from public.chat_channel_members m where m.channel_id = _channel_id)
    or exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = _channel_id and m.user_id = _user_id
    )
$$;
