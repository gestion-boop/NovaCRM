-- Demande explicite : possibilité de créer plusieurs tableaux kanban
-- INDÉPENDANTS ("comme des Pipelines complètement différentes"), chacun
-- avec ses PROPRES colonnes nommées librement (ex: "Idée / En travail /
-- Publié" pour un tableau marketing) — distinct du système "Projet" existant
-- (task_boards, colonnes fixes À faire/En cours/À vérifier/Terminé, qui
-- reste intact) et de "Liste" (internal_todo_items, également intact).

create table if not exists public.kanban_boards (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  name text not null,
  created_by uuid not null references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kanban_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  name text not null,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.kanban_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  column_id uuid not null references public.kanban_columns(id) on delete cascade,
  title text not null,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_kanban_columns_board on public.kanban_columns (board_id);
create index if not exists idx_kanban_cards_board on public.kanban_cards (board_id);
create index if not exists idx_kanban_cards_column on public.kanban_cards (column_id);

alter table public.kanban_boards enable row level security;
alter table public.kanban_columns enable row level security;
alter table public.kanban_cards enable row level security;

-- Périmètre identique aux autres tables "Projets internes" de cette
-- session : tout membre de l'agence peut lire/écrire (outil d'équipe
-- partagé, pas de notion de propriétaire exclusif).
drop policy if exists "kanban_boards: agency members all" on public.kanban_boards;
create policy "kanban_boards: agency members all" on public.kanban_boards
for all to authenticated
using (exists (select 1 from public.agency_members m where m.agency_id = kanban_boards.agency_id and m.user_id = auth.uid()))
with check (exists (select 1 from public.agency_members m where m.agency_id = kanban_boards.agency_id and m.user_id = auth.uid()));

drop policy if exists "kanban_columns: agency members all" on public.kanban_columns;
create policy "kanban_columns: agency members all" on public.kanban_columns
for all to authenticated
using (exists (
  select 1 from public.kanban_boards b join public.agency_members m on m.agency_id = b.agency_id
  where b.id = kanban_columns.board_id and m.user_id = auth.uid()
))
with check (exists (
  select 1 from public.kanban_boards b join public.agency_members m on m.agency_id = b.agency_id
  where b.id = kanban_columns.board_id and m.user_id = auth.uid()
));

drop policy if exists "kanban_cards: agency members all" on public.kanban_cards;
create policy "kanban_cards: agency members all" on public.kanban_cards
for all to authenticated
using (exists (
  select 1 from public.kanban_boards b join public.agency_members m on m.agency_id = b.agency_id
  where b.id = kanban_cards.board_id and m.user_id = auth.uid()
))
with check (exists (
  select 1 from public.kanban_boards b join public.agency_members m on m.agency_id = b.agency_id
  where b.id = kanban_cards.board_id and m.user_id = auth.uid()
));

alter publication supabase_realtime add table public.kanban_boards;
alter publication supabase_realtime add table public.kanban_columns;
alter publication supabase_realtime add table public.kanban_cards;
