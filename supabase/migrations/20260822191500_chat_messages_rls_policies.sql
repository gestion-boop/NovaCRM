-- Cause racine plus large : `chat_messages` a RLS activé mais n'avait
-- STRICTEMENT AUCUNE policy — RLS sans policy = accès totalement bloqué
-- (SELECT ne renvoie jamais aucune ligne, INSERT/UPDATE échouent) pour
-- n'importe quel rôle autre que service_role. Ajout des policies
-- manquantes, sur le même modèle que le reste de l'appli (membre du
-- projet du canal, ou super_admin).

create policy "Chat messages: select by project member"
on public.chat_messages
for select
to authenticated
using (
  has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1
    from public.chat_channels ch
    join public.chat_project_members m on m.project_id = ch.project_id
    where ch.id::text = chat_messages.channel
      and m.user_id = auth.uid()
  )
);

create policy "Chat messages: insert by project member"
on public.chat_messages
for insert
to authenticated
with check (
  has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1
    from public.chat_channels ch
    join public.chat_project_members m on m.project_id = ch.project_id
    where ch.id::text = chat_messages.channel
      and m.user_id = auth.uid()
  )
);

-- UPDATE : nécessaire pour que chaque membre puisse marquer un message lu
-- (append son propre accusé dans read_by) sans pouvoir toucher au contenu
-- d'un message d'un autre — la vérification fine du contenu reste côté
-- client (on ne réécrit que read_by), la policy ne fait que garantir
-- l'appartenance au même projet.
create policy "Chat messages: update by project member"
on public.chat_messages
for update
to authenticated
using (
  has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1
    from public.chat_channels ch
    join public.chat_project_members m on m.project_id = ch.project_id
    where ch.id::text = chat_messages.channel
      and m.user_id = auth.uid()
  )
)
with check (
  has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1
    from public.chat_channels ch
    join public.chat_project_members m on m.project_id = ch.project_id
    where ch.id::text = chat_messages.channel
      and m.user_id = auth.uid()
  )
);
