-- Demande explicite : chat Espace Client digne d'une grande application
-- (Messenger-like) — modifier/supprimer ses propres messages, accusé de
-- réception/lecture. `edited_at` existe déjà sur `messages` ; on ajoute la
-- suppression douce (garde une trace "Message supprimé" plutôt qu'un DELETE
-- physique, cohérent avec le reste du CRM) et un accusé de lecture simple
-- (conversation à 2 participants — client/conseiller — donc un simple
-- horodatage suffit, pas besoin d'un tableau read_by comme pour les
-- discussions de groupe).
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists read_at timestamptz;

-- La policy UPDATE générique existante ("Author updates own message",
-- user_id = auth.uid()) couvre déjà l'édition/suppression douce de ses
-- PROPRES messages. Mais marquer un message comme LU doit être fait par le
-- DESTINATAIRE (jamais l'auteur) — impossible avec cette policy (elle exige
-- d'être l'auteur). Plutôt qu'une policy RLS restreinte par colonne
-- (impossible nativement sans trigger), une fonction SECURITY DEFINER
-- dédiée : ne touche QUE read_at, et vérifie elle-même l'accès à la
-- conversation + que l'appelant n'est PAS l'auteur du message.
create or replace function public.mark_message_read(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
  v_task_id uuid;
  v_user_id uuid;
  v_caller uuid := auth.uid();
begin
  select lead_id, task_id, user_id into v_lead_id, v_task_id, v_user_id
  from public.messages where id = p_message_id;

  if v_user_id is null or v_user_id = v_caller then
    return; -- message introuvable ou c'est l'auteur lui-même : rien à faire
  end if;

  -- Vérifie que l'appelant a bien accès à cette conversation (fiche lead
  -- pour le client comme pour le conseiller), avant de marquer lu.
  if v_lead_id is not null then
    if exists (
      select 1 from public.client_guest_access ga
      where ga.lead_id = v_lead_id and ga.user_id = v_caller and ga.status in ('active', 'envoyee')
    ) or exists (
      select 1 from public.leads l join public.agency_members m on m.agency_id = l.agency_id
      where l.id = v_lead_id and m.user_id = v_caller
    ) then
      update public.messages set read_at = now() where id = p_message_id and read_at is null;
    end if;
  end if;
end;
$$;

grant execute on function public.mark_message_read(uuid) to authenticated;
