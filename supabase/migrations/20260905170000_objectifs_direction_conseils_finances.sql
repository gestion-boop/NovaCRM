-- ─────────────────────────────────────────────────────────────────────────
-- Conseils Finances, 5 septembre : « tout ce qui est CA à venir agence ou
-- CA agence doit être vu que par Sylvain Grazia et Mélanie, c'est tout ».
--
-- L'application reconnaît la direction à son nom ou à son adresse (Mélanie
-- n'est pas super admin). Il faut donc aussi que la base la laisse RÉGLER
-- les objectifs : l'objectif de l'année de l'agence (annual_goals) et ceux
-- des collaborateurs (collaborator_annual_goals) étaient réservés aux super
-- admins. Les deux adresses de la direction s'y ajoutent — rien d'autre ne
-- change, les super admins gardent leurs droits.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.est_direction_conseils_finances()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    's.grazia@conseilfinances.fr',
    'gestion@immosphera.fr'
  );
$$;

drop policy if exists "annual_goals: écriture réservée aux super admins" on public.annual_goals;
create policy "annual_goals: écriture réservée aux super admins" on public.annual_goals
for all to authenticated
using (has_role(auth.uid(), 'super_admin'::app_role) or public.est_direction_conseils_finances())
with check (has_role(auth.uid(), 'super_admin'::app_role) or public.est_direction_conseils_finances());

drop policy if exists "collaborator_annual_goals: lecture de son propre objectif" on public.collaborator_annual_goals;
create policy "collaborator_annual_goals: lecture de son propre objectif" on public.collaborator_annual_goals
for select to authenticated
using (
  user_id = auth.uid()
  or has_role(auth.uid(), 'super_admin'::app_role)
  or public.est_direction_conseils_finances()
);

drop policy if exists "collaborator_annual_goals: écriture réservée aux super admins" on public.collaborator_annual_goals;
create policy "collaborator_annual_goals: écriture réservée aux super admins" on public.collaborator_annual_goals
for all to authenticated
using (has_role(auth.uid(), 'super_admin'::app_role) or public.est_direction_conseils_finances())
with check (has_role(auth.uid(), 'super_admin'::app_role) or public.est_direction_conseils_finances());
