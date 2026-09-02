-- ─────────────────────────────────────────────────────────────────────────
-- Objectif de l'année, demandé le 2 septembre (tableau de bord ImmoSphera).
--
-- « Tout en haut, le CA de l'agence, le CA à venir, et à droite une
--   troisième case : Objectif de l'année, avec un camembert en fonction du
--   CA de l'agence — la soustraction par rapport à l'objectif. »
--
-- Un objectif par agence et par année, sur le modèle de monthly_goals (un
-- objectif par agence et par mois). Lu par les membres de l'agence, écrit
-- par les super admins — comme la tuile Chiffre d'affaires qu'il accompagne.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.annual_goals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  year integer not null,
  target_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, year)
);

alter table public.annual_goals enable row level security;

drop policy if exists "annual_goals: lecture par les membres de l'agence" on public.annual_goals;
create policy "annual_goals: lecture par les membres de l'agence" on public.annual_goals
for select to authenticated
using (
  exists (
    select 1 from public.agency_members m
    where m.user_id = auth.uid() and m.agency_id = annual_goals.agency_id
  )
  or has_role(auth.uid(), 'super_admin'::app_role)
);

drop policy if exists "annual_goals: écriture réservée aux super admins" on public.annual_goals;
create policy "annual_goals: écriture réservée aux super admins" on public.annual_goals
for all to authenticated
using (has_role(auth.uid(), 'super_admin'::app_role))
with check (has_role(auth.uid(), 'super_admin'::app_role));
