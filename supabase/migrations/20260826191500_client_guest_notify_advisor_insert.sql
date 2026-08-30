-- Correctif ticket "Clients invités" (8/13) : la policy RESTRICTIVE ajoutée
-- en 20260826191000 autorise bien l'insertion côté client_guest, MAIS les
-- policies RESTRICTIVE ne font qu'ajouter une condition en ET par-dessus
-- l'ensemble des policies PERMISSIVE — elles ne peuvent jamais, à elles
-- seules, accorder un droit. Or la seule policy PERMISSIVE d'insertion sur
-- `notifications` ("Users insert own notifications") exige `user_id =
-- auth.uid()`, ce qui empêche STRUCTURELLEMENT un client d'insérer une
-- notification ciblant son conseiller (un autre utilisateur). Il faut donc
-- une policy PERMISSIVE dédiée, en plus du verrou restrictif déjà en place.
-- (Vérifié empiriquement avec une vraie session client_guest avant ce
-- correctif : échec sans nom de policy = aucune policy permissive ne
-- matchait.)

drop policy if exists "client_guest: notify own advisor" on public.notifications;
create policy "client_guest: notify own advisor" on public.notifications
for insert to authenticated
with check (
  exists (
    select 1 from public.client_guest_access ga
    join public.leads l on l.id = ga.lead_id
    where ga.user_id = auth.uid()
      and ga.status in ('active', 'envoyee')
      and l.assigned_to = notifications.user_id
  )
);
