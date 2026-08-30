-- Ticket "Clients invités" (11/13) — sécurité stricte, à mettre en place
-- AVANT toute interface cliente réelle (#143 et suivants).
--
-- Découverte en testant avec un vrai compte role=client_guest (RLS
-- respectée, pas la clé service_role) : plusieurs tables n'ont aucune
-- policy restreignant par agence pour un simple utilisateur authentifié
-- (documents, chat_channels, chat_projects, task_boards,
-- internal_project_tasks, messages, agency_members, announcements) —
-- elles renvoyaient des lignes à un compte qui n'est même pas membre d'une
-- agence. Ce n'était pas un problème concret jusqu'ici (aucun rôle
-- n'existait avec un accès aussi restreint que "aucune agence"), mais un
-- client invité EST exactement ce cas — sans verrou explicite, n'importe
-- qui d'un peu technique pourrait interroger l'API Supabase directement
-- (comme fait ici) et voir des documents/messages internes.
--
-- Principe : policies RESTRICTIVE (combinées en ET avec les policies
-- permissives existantes, donc n'affectent AUCUN autre rôle) qui bloquent
-- purement et simplement le rôle client_guest sur tout ce qui n'est pas
-- explicitement sa propre fiche. Les accès fins (documents envoyés/reçus,
-- messages de sa conversation) seront ouverts au fur et à mesure par les
-- tickets #144/#146/#148, jamais avant.

create or replace function public.is_client_guest(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = check_user_id and role = 'client_guest'::app_role
  );
$$;

-- Verrou générique : un client invité ne peut RIEN faire sur ces tables
-- tant que les tickets suivants n'ouvrent pas un accès précis.
do $$
declare
  t text;
  tables text[] := array[
    'documents', 'chat_channels', 'chat_projects', 'chat_project_members',
    'task_boards', 'internal_project_tasks', 'internal_project_task_checklist_items',
    'internal_project_task_activity', 'agency_members', 'announcements',
    'chat_messages', 'notifications'
  ];
begin
  foreach t in array tables loop
    execute format(
      'drop policy if exists %I on public.%I',
      'client_guest_lockdown_' || t, t
    );
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not public.is_client_guest(auth.uid())) with check (not public.is_client_guest(auth.uid()))',
      'client_guest_lockdown_' || t, t
    );
  end loop;
end $$;

-- `messages` est une exception : un client invité doit pouvoir écrire dans
-- SA PROPRE conversation (via task_id une fois #144 branché sur un
-- mécanisme équivalent pour les clients — pas encore le cas). Pour
-- l'instant, verrou total comme les autres, sera affiné au ticket #144.
drop policy if exists "client_guest_lockdown_messages" on public.messages;
create policy "client_guest_lockdown_messages" on public.messages as restrictive
for all to authenticated
using (not public.is_client_guest(auth.uid()))
with check (not public.is_client_guest(auth.uid()));

-- profiles : un client invité ne doit voir QUE son propre profil et celui
-- de son conseiller assigné (pour afficher "votre conseiller" dans son
-- espace) — jamais l'annuaire complet de l'équipe.
drop policy if exists "client_guest_lockdown_profiles" on public.profiles;
create policy "client_guest_lockdown_profiles" on public.profiles as restrictive
for select to authenticated
using (
  not public.is_client_guest(auth.uid())
  or profiles.id = auth.uid()
  or exists (
    select 1 from public.client_guest_access ga
    join public.leads l on l.id = ga.lead_id
    where ga.user_id = auth.uid() and l.assigned_to = profiles.id
  )
);

-- leads : ouvre l'accès étroit à SA PROPRE fiche uniquement (via
-- client_guest_access), en plus des policies agence déjà existantes qui,
-- elles, l'excluent naturellement (pas de ligne agency_members).
drop policy if exists "client_guest: select own lead" on public.leads;
create policy "client_guest: select own lead" on public.leads
for select to authenticated
using (
  exists (
    select 1 from public.client_guest_access ga
    where ga.lead_id = leads.id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
);

-- agencies : lecture du seul nom/logo de SA propre agence (pour l'afficher
-- dans le shell), rien d'autre.
drop policy if exists "client_guest: select own agency" on public.agencies;
create policy "client_guest: select own agency" on public.agencies
for select to authenticated
using (
  exists (
    select 1 from public.client_guest_access ga
    where ga.agency_id = agencies.id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
);

-- client_guest_access : un client invité peut lire SA PROPRE ligne (pour
-- connaître son statut, son conseiller...) — jamais celle des autres.
drop policy if exists "client_guest: select own access row" on public.client_guest_access;
create policy "client_guest: select own access row" on public.client_guest_access
for select to authenticated
using (client_guest_access.user_id = auth.uid());
