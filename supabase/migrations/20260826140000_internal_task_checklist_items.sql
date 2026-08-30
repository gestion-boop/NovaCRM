-- Ticket "Refonte fiche tâche" (4/6) : sous-éléments cochables à l'intérieur
-- d'une tâche de Projets internes (onglet Checklist), avec badge de
-- progression sur la carte du tableau (ex. "4/5").

create table if not exists public.internal_project_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.internal_project_tasks(id) on delete cascade,
  text text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_internal_task_checklist_items_task on public.internal_project_task_checklist_items (task_id);

alter table public.internal_project_task_checklist_items enable row level security;

-- Visibilité calquée sur la tâche parente : la sous-requête sur
-- internal_project_tasks est elle-même filtrée par SA propre RLS (déjà
-- correcte, y compris la restriction stagiaire — cf.
-- 20260825191500_intern_task_visibility.sql), donc une seule règle simple
-- suffit ici plutôt que de dupliquer toute la logique agence/rôle/stagiaire.
create policy "internal_task_checklist_items: select if task visible"
on public.internal_project_task_checklist_items for select
to authenticated
using (
  exists (select 1 from public.internal_project_tasks t where t.id = internal_project_task_checklist_items.task_id)
);

create policy "internal_task_checklist_items: insert if task visible"
on public.internal_project_task_checklist_items for insert
to authenticated
with check (
  exists (select 1 from public.internal_project_tasks t where t.id = internal_project_task_checklist_items.task_id)
);

create policy "internal_task_checklist_items: update if task visible"
on public.internal_project_task_checklist_items for update
to authenticated
using (
  exists (select 1 from public.internal_project_tasks t where t.id = internal_project_task_checklist_items.task_id)
)
with check (
  exists (select 1 from public.internal_project_tasks t where t.id = internal_project_task_checklist_items.task_id)
);

create policy "internal_task_checklist_items: delete if task visible"
on public.internal_project_task_checklist_items for delete
to authenticated
using (
  exists (select 1 from public.internal_project_tasks t where t.id = internal_project_task_checklist_items.task_id)
);

alter publication supabase_realtime add table public.internal_project_task_checklist_items;
