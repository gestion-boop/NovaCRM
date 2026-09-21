-- Backfill chat_project_members for users already invited to a restricted
-- channel via chat_channel_members but never synced to chat_project_members.
-- Without this, the "Participants" UI shows them as members, but the RLS
-- policy on chat_messages (select by project member) requires presence in
-- BOTH tables, so they never actually receive or see channel messages
-- (e.g. Christophe Hirsch on Immosphera channels).

insert into public.chat_project_members (project_id, user_id, added_by)
select distinct ch.project_id, cm.user_id, cm.added_by
from public.chat_channel_members cm
join public.chat_channels ch on ch.id = cm.channel_id
on conflict (project_id, user_id) do nothing;

-- Defense in depth: keep the two tables in sync server-side for any future
-- insert path into chat_channel_members (SQL import, admin tooling, etc.),
-- not just the client-side addChannelMember flow.
create or replace function public.tg_chat_channel_members_sync_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id
  from public.chat_channels
  where id = new.channel_id;

  if v_project_id is not null then
    insert into public.chat_project_members (project_id, user_id, added_by)
    values (v_project_id, new.user_id, new.added_by)
    on conflict (project_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_chat_channel_members_sync_project on public.chat_channel_members;

create trigger trg_chat_channel_members_sync_project
after insert on public.chat_channel_members
for each row
execute function public.tg_chat_channel_members_sync_project();
