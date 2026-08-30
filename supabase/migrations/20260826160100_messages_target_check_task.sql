-- Suite de la migration précédente : la contrainte existante
-- `messages_target_check` n'autorisait qu'exactement conversation_id OU
-- channel_id renseigné — bloquait toute ligne avec seulement task_id
-- (nouveau, pour le chat par tâche). Élargie pour accepter les trois cas,
-- toujours exactement un seul renseigné par message.

alter table public.messages drop constraint if exists messages_target_check;

alter table public.messages add constraint messages_target_check check (
  (
    (case when conversation_id is not null then 1 else 0 end) +
    (case when channel_id is not null then 1 else 0 end) +
    (case when task_id is not null then 1 else 0 end)
  ) = 1
);
