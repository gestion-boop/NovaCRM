-- Ticket "Projets internes" (phase 1/plusieurs) : les Projets internes
-- existants (table `task_boards`) n'ont qu'un statut global unique par
-- projet — aucune tâche individuelle, donc aucun kanban possible. Cette
-- table ajoute les vraies cartes déplaçables (À faire/En cours/À
-- vérifier/Terminé) à l'intérieur d'un projet, sans toucher à `task_boards`
-- ni à rien d'existant.

create table if not exists public.internal_project_tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.task_boards(id) on delete cascade,
  agency_id uuid not null references public.agencies(id),
  title text not null,
  description text,
  priority text not null default 'normale' check (priority in ('basse', 'normale', 'haute', 'urgente')),
  status text not null default 'a_faire' check (status in ('a_faire', 'en_cours', 'a_verifier', 'termine')),
  due_date timestamptz,
  position integer not null default 0,
  -- Plusieurs collaborateurs possibles sur une même tâche (demande
  -- explicite), en plus du créateur (`created_by`, le responsable).
  collaborator_ids uuid[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_internal_project_tasks_board on public.internal_project_tasks (board_id);
create index if not exists idx_internal_project_tasks_agency on public.internal_project_tasks (agency_id);
create index if not exists idx_internal_project_tasks_collaborators on public.internal_project_tasks using gin (collaborator_ids);

alter table public.internal_project_tasks enable row level security;

-- Même principe que le reste de l'appli (super_admin partout, sinon membre
-- de l'agence du projet) — cohérent avec les policies déjà en place sur
-- chat_messages/chat_channels.
create policy "internal_project_tasks: select by agency member"
on public.internal_project_tasks for select
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = internal_project_tasks.agency_id
      and m.user_id = auth.uid()
  )
);

create policy "internal_project_tasks: insert by agency member"
on public.internal_project_tasks for insert
to authenticated
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = internal_project_tasks.agency_id
      and m.user_id = auth.uid()
  )
);

create policy "internal_project_tasks: update by agency member"
on public.internal_project_tasks for update
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = internal_project_tasks.agency_id
      and m.user_id = auth.uid()
  )
)
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = internal_project_tasks.agency_id
      and m.user_id = auth.uid()
  )
);

create policy "internal_project_tasks: delete by agency member"
on public.internal_project_tasks for delete
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = internal_project_tasks.agency_id
      and m.user_id = auth.uid()
  )
);

-- Synchro multi-appareils immédiate (mêmes principes que chat_messages).
alter publication supabase_realtime add table public.internal_project_tasks;
