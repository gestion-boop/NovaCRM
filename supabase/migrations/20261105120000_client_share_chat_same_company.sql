-- Chat d'un dossier partagé : réservé aux personnes de la MÊME société que le
-- client (agence du lead). Les super admins (présents dans toutes les sociétés)
-- restent autorisés.

create or replace function public.est_membre_agence_du_lead(_lead uuid, _user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fonction$
  select exists (
           select 1
             from public.leads l
             join public.agency_members am on am.agency_id = l.agency_id
            where l.id = _lead and am.user_id = _user
         )
      or public.has_role(_user, 'super_admin'::app_role);
$fonction$;

-- Lecture et écriture des messages : participant du partage ET de la même société.
drop policy if exists client_share_messages_select on public.client_share_messages;
create policy client_share_messages_select on public.client_share_messages
  for select to authenticated
  using (
    public.est_membre_agence_du_lead(lead_id, (select auth.uid()))
    and (
      exists (select 1 from public.leads l where l.id = client_share_messages.lead_id
                and (l.created_by = (select auth.uid()) or l.assigned_to = (select auth.uid())))
      or exists (select 1 from public.client_shares cs where cs.lead_id = client_share_messages.lead_id
                   and (cs.shared_with = (select auth.uid()) or cs.shared_by = (select auth.uid())))
    )
  );

drop policy if exists client_share_messages_insert on public.client_share_messages;
create policy client_share_messages_insert on public.client_share_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.est_membre_agence_du_lead(lead_id, (select auth.uid()))
    and (
      exists (select 1 from public.leads l where l.id = client_share_messages.lead_id
                and (l.created_by = (select auth.uid()) or l.assigned_to = (select auth.uid())))
      or exists (select 1 from public.client_shares cs where cs.lead_id = client_share_messages.lead_id
                   and (cs.shared_with = (select auth.uid()) or cs.shared_by = (select auth.uid())))
    )
  );

-- Un nouveau partage ne peut viser qu'une personne de la société du client.
create or replace function public.tg_client_shares_meme_societe()
returns trigger
language plpgsql
security definer
set search_path = public
as $fonction$
begin
  if not public.est_membre_agence_du_lead(new.lead_id, new.shared_with) then
    raise exception 'Cette personne ne fait pas partie de la société de ce client.' using errcode = '42501';
  end if;
  return new;
end;
$fonction$;

drop trigger if exists trg_client_shares_meme_societe on public.client_shares;
create trigger trg_client_shares_meme_societe
  before insert on public.client_shares
  for each row execute function public.tg_client_shares_meme_societe();
