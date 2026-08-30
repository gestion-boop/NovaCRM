-- Demande urgente : onglet "Liste" dans Projets internes — une checklist
-- simple façon Todoist (texte + coché/pas coché), séparée du tableau à
-- colonnes (task_boards) : chaque élément peut ensuite être "basculé sur
-- les colonnes" (promu en carte À faire sur le tableau Kanban existant).

create table if not exists public.internal_todo_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_internal_todo_items_agency on public.internal_todo_items (agency_id);

alter table public.internal_todo_items enable row level security;

drop policy if exists "internal_todo_items: agency members select" on public.internal_todo_items;
create policy "internal_todo_items: agency members select" on public.internal_todo_items
for select to authenticated
using (
  exists (select 1 from public.agency_members m where m.agency_id = internal_todo_items.agency_id and m.user_id = auth.uid())
);

drop policy if exists "internal_todo_items: agency members insert" on public.internal_todo_items;
create policy "internal_todo_items: agency members insert" on public.internal_todo_items
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from public.agency_members m where m.agency_id = internal_todo_items.agency_id and m.user_id = auth.uid())
);

drop policy if exists "internal_todo_items: agency members update" on public.internal_todo_items;
create policy "internal_todo_items: agency members update" on public.internal_todo_items
for update to authenticated
using (
  exists (select 1 from public.agency_members m where m.agency_id = internal_todo_items.agency_id and m.user_id = auth.uid())
);

drop policy if exists "internal_todo_items: agency members delete" on public.internal_todo_items;
create policy "internal_todo_items: agency members delete" on public.internal_todo_items
for delete to authenticated
using (
  exists (select 1 from public.agency_members m where m.agency_id = internal_todo_items.agency_id and m.user_id = auth.uid())
);

alter publication supabase_realtime add table public.internal_todo_items;
