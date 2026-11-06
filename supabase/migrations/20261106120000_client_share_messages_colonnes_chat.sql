-- Chat d'un dossier partagé : l'écran lisait is_edited / is_deleted / reactions,
-- colonnes absentes de la table — la lecture échouait donc et le chat paraissait
-- vide alors que les messages étaient bien enregistrés (6 nov.).
alter table public.client_share_messages
  add column if not exists is_edited boolean not null default false,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists reactions jsonb not null default '[]'::jsonb;

-- Modification (accusés de lecture, édition, réactions) : participants de la même société.
drop policy if exists client_share_messages_update on public.client_share_messages;
create policy client_share_messages_update on public.client_share_messages
  for update to authenticated
  using (
    public.est_membre_agence_du_lead(lead_id, (select auth.uid()))
    and (
      exists (select 1 from public.leads l where l.id = client_share_messages.lead_id
                and (l.created_by = (select auth.uid()) or l.assigned_to = (select auth.uid())))
      or exists (select 1 from public.client_shares cs where cs.lead_id = client_share_messages.lead_id
                   and (cs.shared_with = (select auth.uid()) or cs.shared_by = (select auth.uid())))
    )
  )
  with check (public.est_membre_agence_du_lead(lead_id, (select auth.uid())));
