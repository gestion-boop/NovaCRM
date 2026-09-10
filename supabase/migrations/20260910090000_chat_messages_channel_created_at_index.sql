-- Audit global demandé (10 septembre) : « les messages historiques, cela
-- ne se charge pas dans les chats ou souvent cela met un peu plus de
-- temps ». Trouvé via EXPLAIN sur la requête réelle du client
-- (ChatViewSupabase.tsx, loadMessages : filtre par channel, tri par
-- created_at desc, limit 60) : chat_messages n'avait que deux index
-- séparés (channel) et (created_at), jamais un composite — le planificateur
-- doit donc faire un tri en mémoire après l'index scan sur channel, au lieu
-- d'un simple parcours ordonné. La table `messages` (conversations
-- directes) avait déjà le bon index composite pour sa requête équivalente
-- (idx_messages_conv) ; ce n'était qu'un oubli côté chat_messages (canaux
-- d'équipe).
create index if not exists idx_chat_messages_channel_created_at
  on public.chat_messages (channel, created_at);
