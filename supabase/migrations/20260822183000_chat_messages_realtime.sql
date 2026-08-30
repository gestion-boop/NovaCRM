-- Bug remonté : le badge "Chat" (canaux d'équipe) ne redescendait jamais
-- immédiatement après lecture, et les nouveaux messages n'apparaissaient
-- pas en direct dans un canal ouvert — `chat_messages` n'était tout
-- simplement pas dans la publication temps réel Supabase (contrairement à
-- `messages`, `message_receipts`, `notifications`), donc aucun événement
-- postgres_changes n'était jamais délivré pour cette table, quel que soit
-- le code d'abonnement côté client. Seul le sondage périodique (30s)
-- rattrapait l'état, avec un délai perceptible.
alter publication supabase_realtime add table public.chat_messages;
