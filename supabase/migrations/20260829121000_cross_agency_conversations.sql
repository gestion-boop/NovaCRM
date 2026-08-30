-- Demande explicite (29/08/2026) : "chaque entité doit être cloisonné,
-- sauf pour les chats, où les 3 entités, tout le monde peut poster. Chaque
-- utilisateur peut créer des groupes aussi avec des utilisateurs de
-- plusieurs agences différentes."
--
-- Jusqu'ici, les policies RLS de `conversations`/`conversation_members`
-- exigeaient TOUJOURS un agency_id non nul et vérifiaient que CHAQUE
-- participant appartient à CETTE agence — impossible donc de créer une
-- conversation (directe ou groupe) entre utilisateurs de deux agences
-- différentes, même en corrigeant l'interface. `agency_id` est déjà
-- nullable en base (comme chat_projects/chat_channels, qui utilisent déjà
-- ce même principe pour l'espace "3 Entités") : on autorise ici
-- explicitement agency_id NULL comme conversation "multi-entités", sans
-- toucher au comportement existant des conversations à agence unique.

drop policy if exists "Members create entity conversations" on public.conversations;
create policy "Members create conversations"
  on public.conversations for insert
  with check (
    created_by = auth.uid()
    and (agency_id is null or is_agency_member(auth.uid(), agency_id))
  );

drop policy if exists "Members view entity conversations" on public.conversations;
create policy "Members view conversations"
  on public.conversations for select
  using (
    is_conversation_member(auth.uid(), id)
    and (agency_id is null or is_agency_member(auth.uid(), agency_id))
  );

drop policy if exists "Creator updates entity conversation" on public.conversations;
create policy "Creator updates conversation"
  on public.conversations for update
  using (
    (agency_id is null or is_agency_member(auth.uid(), agency_id))
    and (created_by = auth.uid() or has_role(auth.uid(), 'super_admin'::app_role))
  )
  with check (
    (agency_id is null or is_agency_member(auth.uid(), agency_id))
    and (created_by = auth.uid() or has_role(auth.uid(), 'super_admin'::app_role))
  );

drop policy if exists "Creator deletes entity conversation" on public.conversations;
create policy "Creator deletes conversation"
  on public.conversations for delete
  using (
    (agency_id is null or is_agency_member(auth.uid(), agency_id))
    and (created_by = auth.uid() or has_role(auth.uid(), 'super_admin'::app_role))
  );

-- conversation_members : ajouter un participant à une conversation
-- multi-entités (agency_id null) n'exige plus que lui ET l'ajouteur soient
-- dans une même agence — seulement que l'ajouteur soit bien créateur ou
-- déjà membre de la conversation (inchangé pour les conversations à agence
-- unique, où la restriction "même agence" reste appliquée).
drop policy if exists "Members add participants from same entity" on public.conversation_members;
create policy "Members add participants"
  on public.conversation_members for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_members.conversation_id
        and (c.agency_id is null or is_agency_member(auth.uid(), c.agency_id))
        and (c.agency_id is null or is_agency_member(conversation_members.user_id, c.agency_id))
        and (c.created_by = auth.uid() or is_conversation_member(auth.uid(), c.id))
    )
  );

drop policy if exists "Self leave or entity creator remove" on public.conversation_members;
create policy "Self leave or creator remove"
  on public.conversation_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_members.conversation_id
        and (c.agency_id is null or is_agency_member(auth.uid(), c.agency_id))
        and (c.created_by = auth.uid() or has_role(auth.uid(), 'super_admin'::app_role))
    )
  );
