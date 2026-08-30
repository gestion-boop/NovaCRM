-- Ticket "Clients invités" (8/13) : chat relié à la fiche client — chaque
-- client invité a une conversation unique avec sa fiche (lead_id), en
-- réutilisant la table `messages` déjà existante (même principe que le
-- chat par tâche des Projets internes — additive, jamais de nouvelle table
-- de messages).

alter table public.messages
  add column if not exists lead_id uuid references public.leads(id) on delete cascade;

create index if not exists idx_messages_lead_id on public.messages (lead_id);

-- La contrainte "un seul type de cible par message" doit maintenant
-- accepter lead_id comme 4e option (en plus de conversation_id/channel_id/
-- task_id déjà gérés).
alter table public.messages drop constraint if exists messages_target_check;
alter table public.messages add constraint messages_target_check check (
  (
    (case when conversation_id is not null then 1 else 0 end) +
    (case when channel_id is not null then 1 else 0 end) +
    (case when task_id is not null then 1 else 0 end) +
    (case when lead_id is not null then 1 else 0 end)
  ) = 1
);

-- Équipe (agence de la fiche) : lit/écrit dans la conversation de la fiche.
drop policy if exists "messages: staff select by lead agency" on public.messages;
create policy "messages: staff select by lead agency"
on public.messages for select
to authenticated
using (
  lead_id is not null
  and exists (
    select 1 from public.leads l
    join public.agency_members m on m.agency_id = l.agency_id
    where l.id = messages.lead_id and m.user_id = auth.uid()
  )
);

drop policy if exists "messages: staff insert by lead agency" on public.messages;
create policy "messages: staff insert by lead agency"
on public.messages for insert
to authenticated
with check (
  lead_id is not null
  and user_id = auth.uid()
  and exists (
    select 1 from public.leads l
    join public.agency_members m on m.agency_id = l.agency_id
    where l.id = messages.lead_id and m.user_id = auth.uid()
  )
);

-- Client invité : lit/écrit UNIQUEMENT dans la conversation de SA propre
-- fiche (via client_guest_access), jamais celle d'un autre client — ces
-- policies permissives, combinées avec le verrou restrictif déjà en place
-- (client_guest_lockdown_messages, migration précédente), donnent
-- exactement l'accès voulu : bloqué partout SAUF ici.
drop policy if exists "messages: client_guest select own lead conversation" on public.messages;
create policy "messages: client_guest select own lead conversation"
on public.messages for select
to authenticated
using (
  lead_id is not null
  and exists (
    select 1 from public.client_guest_access ga
    where ga.lead_id = messages.lead_id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
);

drop policy if exists "messages: client_guest insert own lead conversation" on public.messages;
create policy "messages: client_guest insert own lead conversation"
on public.messages for insert
to authenticated
with check (
  lead_id is not null
  and user_id = auth.uid()
  and exists (
    select 1 from public.client_guest_access ga
    where ga.lead_id = messages.lead_id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
);

-- Le verrou restrictif générique (migration 20260826180000) bloque TOUT
-- pour client_guest sur `messages`, y compris désormais lead_id. On le
-- remplace par une version qui autorise explicitement sa propre conversation.
drop policy if exists "client_guest_lockdown_messages" on public.messages;
create policy "client_guest_lockdown_messages" on public.messages as restrictive
for all to authenticated
using (
  not public.is_client_guest(auth.uid())
  or (
    lead_id is not null
    and exists (
      select 1 from public.client_guest_access ga
      where ga.lead_id = messages.lead_id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
    )
  )
)
with check (
  not public.is_client_guest(auth.uid())
  or (
    lead_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from public.client_guest_access ga
      where ga.lead_id = messages.lead_id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
    )
  )
);
