-- Signalé : "l'utilisateur assigné à l'espace client ne reçoit pas de
-- notification quand le client lui envoie un message". Diagnostiqué avec
-- une vraie session client_guest (magic-link + service role, nettoyée
-- après coup) : l'INSERT échouait de façon INTERMITTENTE avec "new row
-- violates row-level security policy" — jamais un vrai refus logique (les
-- données correspondaient bien : client_guest_access.status='active',
-- lead.assigned_to = destinataire), mais un comportement instable.
--
-- Cause : la policy 20260826191500 vérifie un EXISTS qui JOINT
-- `client_guest_access` et `leads` DIRECTEMENT dans la policy de
-- `notifications`. Or `leads` a SA PROPRE policy RLS de lecture
-- ("client_guest: select own lead") qui, elle-même, ré-interroge
-- `client_guest_access` (qui a ENCORE sa propre RLS). Cette évaluation de
-- policy imbriquée dans policy (déjà rencontrée avec announcement_agencies,
-- migration 20260826214000) rend le résultat dépendant du plan
-- d'exécution choisi par Postgres — parfois correct, parfois pas, comme
-- observé empiriquement (5 tentatives identiques : tantôt OK, tantôt KO).
--
-- Fix : même remède que pour les annonces — une fonction SECURITY DEFINER
-- qui contourne délibérément le RLS des tables qu'elle interroge en
-- interne, pour répondre de façon fiable à une question binaire précise
-- ("ce client_guest a-t-il le droit de notifier CET utilisateur ?"),
-- aucune donnée exposée au-delà de ce booléen.
create or replace function public.client_guest_can_notify_advisor(p_advisor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_guest_access ga
    join public.leads l on l.id = ga.lead_id
    where ga.user_id = auth.uid()
      and ga.status in ('active', 'envoyee')
      and l.assigned_to = p_advisor_id
  );
$$;

grant execute on function public.client_guest_can_notify_advisor(uuid) to authenticated;

drop policy if exists "client_guest: notify own advisor" on public.notifications;
create policy "client_guest: notify own advisor" on public.notifications
for insert to authenticated
with check (public.client_guest_can_notify_advisor(notifications.user_id));

drop policy if exists "client_guest_lockdown_notifications" on public.notifications;
create policy "client_guest_lockdown_notifications" on public.notifications as restrictive
for all to authenticated
using (not public.is_client_guest(auth.uid()))
with check (
  not public.is_client_guest(auth.uid())
  or public.client_guest_can_notify_advisor(notifications.user_id)
);
