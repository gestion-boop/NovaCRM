-- Envoi différé (Chat Équipe) : la table `scheduled_messages` existe déjà
-- côté base (créée à la main, jamais suivie par une migration ni branchée à
-- aucun code) — on la termine ici : sécurité RLS, contrainte de cohérence
-- et valeurs par défaut, sur le même modèle que `messages`
-- (`messages_target_check`, migration 20260826160100).

alter table public.scheduled_messages enable row level security;

-- Exactement une destination par message programmé : un canal de dossier
-- OU une conversation directe, jamais les deux, jamais aucune.
alter table public.scheduled_messages drop constraint if exists scheduled_messages_target_check;
alter table public.scheduled_messages add constraint scheduled_messages_target_check check (
  (
    (case when channel_id is not null then 1 else 0 end) +
    (case when conversation_id is not null then 1 else 0 end)
  ) = 1
);

alter table public.scheduled_messages alter column status set default 'pending';
alter table public.scheduled_messages alter column kind set default 'text';

-- Lue par la fonction Edge run-automations à chaque déclenchement (~15 min)
-- pour repérer les messages dus.
create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (status, scheduled_at);

drop policy if exists "scheduled_messages_select_own" on public.scheduled_messages;
create policy "scheduled_messages_select_own" on public.scheduled_messages
  for select using (user_id = auth.uid());

drop policy if exists "scheduled_messages_insert_own" on public.scheduled_messages;
create policy "scheduled_messages_insert_own" on public.scheduled_messages
  for insert with check (user_id = auth.uid());

-- Un message déjà parti (ou en cours d'envoi) ne se retouche plus depuis le
-- client — seule la fonction Edge (clé de service, hors RLS) fait cette
-- transition-là.
drop policy if exists "scheduled_messages_update_own_pending" on public.scheduled_messages;
create policy "scheduled_messages_update_own_pending" on public.scheduled_messages
  for update using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists "scheduled_messages_delete_own_pending" on public.scheduled_messages;
create policy "scheduled_messages_delete_own_pending" on public.scheduled_messages
  for delete using (user_id = auth.uid() and status = 'pending');
