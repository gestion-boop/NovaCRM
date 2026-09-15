-- Demande explicite : « je vais pouvoir inviter n'importe quel collaborateur
-- [...] quand le dossier réseaux sociaux est créé, je veux créer un canal
-- Laetitia je veux inviter Laetitia avec une autre personne dedans [...] je
-- veux choisir qui participe à chaque canal. »
--
-- Jusqu'ici, la participation se gérait uniquement au niveau du DOSSIER
-- (chat_project_members) : tout membre du dossier voit TOUS ses canaux. Ici
-- on ajoute un niveau de restriction par CANAL, optionnel (colonne
-- `restricted`, false par défaut) pour ne rien changer aux canaux existants
-- (« Général » etc. restent visibles par tout le dossier).

alter table public.chat_channels add column if not exists restricted boolean not null default false;

create table if not exists public.chat_channel_members (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null,
  added_by uuid,
  created_at timestamptz not null default now(),
  unique (channel_id, user_id)
);

alter table public.chat_channel_members enable row level security;

-- Un membre peut voir un canal si : super admin, créateur du canal, canal
-- non restreint (comportement historique), ou membre explicitement invité.
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
    or not exists (select 1 from public.chat_channels c where c.id = _channel_id and c.restricted)
    or exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = _channel_id and m.user_id = _user_id
    )
$$;

-- chat_channels : la visibilité restait uniquement conditionnée à
-- l'appartenance au dossier — on ajoute la restriction par canal en plus,
-- sans rien retirer.
drop policy if exists "Members view channels" on public.chat_channels;
create policy "Members view channels"
  on public.chat_channels for select
  using (can_access_chat_project(auth.uid(), project_id) and can_view_chat_channel(auth.uid(), id));

-- chat_messages : même logique, en plus de l'appartenance au dossier déjà
-- vérifiée.
drop policy if exists "Chat messages: select by project member" on public.chat_messages;
create policy "Chat messages: select by project member"
  on public.chat_messages for select
  using (
    has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      join public.chat_project_members m on m.project_id = ch.project_id
      where ch.id::text = chat_messages.channel
        and m.user_id = auth.uid()
        and can_view_chat_channel(auth.uid(), ch.id)
    )
  );

drop policy if exists "Chat messages: insert by project member" on public.chat_messages;
create policy "Chat messages: insert by project member"
  on public.chat_messages for insert
  with check (
    has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      join public.chat_project_members m on m.project_id = ch.project_id
      where ch.id::text = chat_messages.channel
        and m.user_id = auth.uid()
        and can_view_chat_channel(auth.uid(), ch.id)
    )
  );

drop policy if exists "Chat messages: update by project member" on public.chat_messages;
create policy "Chat messages: update by project member"
  on public.chat_messages for update
  using (
    has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      join public.chat_project_members m on m.project_id = ch.project_id
      where ch.id::text = chat_messages.channel
        and m.user_id = auth.uid()
        and can_view_chat_channel(auth.uid(), ch.id)
    )
  )
  with check (
    has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      join public.chat_project_members m on m.project_id = ch.project_id
      where ch.id::text = chat_messages.channel
        and m.user_id = auth.uid()
        and can_view_chat_channel(auth.uid(), ch.id)
    )
  );

-- chat_channel_members : qui peut voir / gérer la liste des invités d'un
-- canal. Voir la liste = déjà pouvoir voir le canal (donc rien de plus
-- exposé qu'aujourd'hui). Ajouter/retirer = créateur du canal, créateur du
-- dossier, ou super admin (même règle que pour les membres de dossier).
create policy "Voir les membres d'un canal visible"
  on public.chat_channel_members for select
  using (
    exists (
      select 1 from public.chat_channels ch
      where ch.id = channel_id
        and can_access_chat_project(auth.uid(), ch.project_id)
        and can_view_chat_channel(auth.uid(), ch.id)
    )
  );

create policy "Créateur ou admin invite au canal"
  on public.chat_channel_members for insert
  with check (
    has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      where ch.id = channel_id
        and (ch.created_by = auth.uid() or is_chat_project_creator(auth.uid(), ch.project_id))
    )
  );

create policy "Créateur ou admin retire du canal"
  on public.chat_channel_members for delete
  using (
    user_id = auth.uid()
    or has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_channels ch
      where ch.id = channel_id
        and (ch.created_by = auth.uid() or is_chat_project_creator(auth.uid(), ch.project_id))
    )
  );

create policy "client_guest_lockdown_chat_channel_members"
  on public.chat_channel_members for all
  using (not is_client_guest(auth.uid()))
  with check (not is_client_guest(auth.uid()));
