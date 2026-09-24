-- Corrige le cloisonnement des canaux : une policy FOR ALL est permissive
-- par défaut et ouvrait SELECT/INSERT/DELETE à tout collaborateur connecté.
drop policy if exists "client_guest_lockdown_chat_channel_members" on public.chat_channel_members;
create policy "client_guest_lockdown_chat_channel_members"
  on public.chat_channel_members as restrictive
  for all to authenticated
  using (not public.is_client_guest(auth.uid()))
  with check (not public.is_client_guest(auth.uid()));

-- Appliquer la même règle sûre aux conversations, y compris si la migration
-- du 24/09 avait déjà été exécutée manuellement sur un environnement.
drop policy if exists "Members add participants from same entity" on public.conversation_members;
drop policy if exists "Members add participants" on public.conversation_members;
create policy "Members add participants"
  on public.conversation_members for insert to authenticated
  with check (
    public.est_auteur_conversation(conversation_id, auth.uid())
    or public.is_conversation_member(auth.uid(), conversation_id)
  );
