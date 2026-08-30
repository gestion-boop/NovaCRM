-- Ticket "Clients invités" (8/13) : quand un client invité envoie un
-- message dans sa conversation, son conseiller reçoit une notification
-- (même table `notifications` déjà utilisée partout ailleurs — pas de
-- nouveau mécanisme). Le verrou générique client_guest (migration
-- 20260826180000) bloque aujourd'hui toute écriture dans `notifications` ;
-- on l'affine ici pour n'autoriser QUE l'insertion d'une notification
-- ciblant le conseiller assigné à SA PROPRE fiche — rien d'autre (pas de
-- lecture/modif/suppression des notifications d'autrui).

drop policy if exists "client_guest_lockdown_notifications" on public.notifications;
create policy "client_guest_lockdown_notifications" on public.notifications as restrictive
for all to authenticated
using (not public.is_client_guest(auth.uid()))
with check (
  not public.is_client_guest(auth.uid())
  or exists (
    select 1 from public.client_guest_access ga
    join public.leads l on l.id = ga.lead_id
    where ga.user_id = auth.uid()
      and ga.status in ('active', 'envoyee')
      and l.assigned_to = notifications.user_id
  )
);
