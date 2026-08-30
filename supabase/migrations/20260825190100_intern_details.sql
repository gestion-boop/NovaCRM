-- Ticket "Rôle Stagiaire" (phase 2) : durée de stage / accès temporaire.
-- `user_roles.expires_at` existe déjà (jamais utilisé) et sert de date de
-- FIN — cette table n'ajoute que ce qui manque : date de DÉBUT et
-- responsable du stage. Séparée de `user_roles` (générique à tous les
-- rôles) pour ne rien polluer qui ne concerne QUE les stagiaires.

create table if not exists public.intern_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  starts_at date not null default current_date,
  responsable_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.intern_details enable row level security;

-- Lecture : le stagiaire lui-même, son responsable, ou un super admin.
create policy "intern_details: select"
on public.intern_details for select
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or user_id = auth.uid()
  or responsable_id = auth.uid()
);

-- Écriture : réservée aux super admins (création/prolongation du stage
-- depuis Équipe/Paramètres) — jamais le stagiaire lui-même.
create policy "intern_details: insert"
on public.intern_details for insert
to authenticated
with check (public.has_role(auth.uid(), 'super_admin'::app_role));

create policy "intern_details: update"
on public.intern_details for update
to authenticated
using (public.has_role(auth.uid(), 'super_admin'::app_role))
with check (public.has_role(auth.uid(), 'super_admin'::app_role));

create policy "intern_details: delete"
on public.intern_details for delete
to authenticated
using (public.has_role(auth.uid(), 'super_admin'::app_role));
