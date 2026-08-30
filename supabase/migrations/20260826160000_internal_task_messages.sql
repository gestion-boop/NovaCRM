-- Ticket "Refonte fiche tâche" (6/6) : chat par tâche — réutilise la table
-- `messages` déjà existante (conversations directes + canaux d'équipe,
-- colonnes kind/body/attachment_url/attachment_mime/attachment_duration
-- déjà prêtes pour texte/image/voix/fichier) plutôt qu'un système séparé.
-- Nouvelle colonne additive `task_id`, nullable, sans toucher aux lignes
-- existantes (conversation_id / channel_id) ni à leurs policies RLS —
-- les nouvelles policies ci-dessous ne s'appliquent qu'aux lignes qui ont
-- task_id renseigné.

alter table public.messages
  add column if not exists task_id uuid references public.internal_project_tasks(id) on delete cascade;

create index if not exists idx_messages_task_id on public.messages (task_id);

alter table public.messages enable row level security;

drop policy if exists "messages: select by task visibility" on public.messages;
create policy "messages: select by task visibility"
on public.messages for select
to authenticated
using (
  task_id is not null
  and exists (select 1 from public.internal_project_tasks t where t.id = messages.task_id)
);

drop policy if exists "messages: insert by task visibility" on public.messages;
create policy "messages: insert by task visibility"
on public.messages for insert
to authenticated
with check (
  task_id is not null
  and user_id = auth.uid()
  and exists (select 1 from public.internal_project_tasks t where t.id = messages.task_id)
);

drop policy if exists "messages: update own by task visibility" on public.messages;
create policy "messages: update own by task visibility"
on public.messages for update
to authenticated
using (
  task_id is not null
  and user_id = auth.uid()
  and exists (select 1 from public.internal_project_tasks t where t.id = messages.task_id)
)
with check (
  task_id is not null
  and user_id = auth.uid()
  and exists (select 1 from public.internal_project_tasks t where t.id = messages.task_id)
);

-- Realtime : ajoute la table seulement si elle n'y est pas déjà (sinon
-- erreur "already member of publication" — elle y est peut-être déjà pour
-- les conversations/canaux existants).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
