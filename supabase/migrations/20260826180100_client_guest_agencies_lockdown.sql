-- Suite de 20260826180000_client_guest_lockdown.sql — `agencies` avait été
-- oubliée du verrou générique (elle a sa propre policy permissive étroite,
-- ajoutée dans la même migration, mais sans le filet restrictive qui
-- l'accompagne pour les autres tables).
drop policy if exists "client_guest_lockdown_agencies" on public.agencies;
create policy "client_guest_lockdown_agencies" on public.agencies as restrictive
for select to authenticated
using (
  not public.is_client_guest(auth.uid())
  or exists (
    select 1 from public.client_guest_access ga
    where ga.agency_id = agencies.id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
);
