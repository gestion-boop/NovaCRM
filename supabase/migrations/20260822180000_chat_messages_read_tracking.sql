-- Bug remonté : le badge "Chat" (tuile Accueil, barre du haut) ne
-- descendait jamais pour les messages de canaux d'équipe (chat_messages),
-- même après lecture — parce que la table n'a jamais eu de colonnes
-- sender_id/is_deleted/read_by (le code JS les lisait comme si elles
-- existaient, mais elles retombaient toujours sur undefined/[], rendant
-- CHAQUE message, y compris les siens, éternellement "non lu").
--
-- Ajout additif, sans casser l'existant (le JSONB `data` reste la source
-- d'affichage) : sender_id/is_deleted backfillés depuis `data` pour les
-- lignes déjà en base, read_by démarré vide pour être rempli à la lecture.

alter table public.chat_messages
  add column if not exists sender_id uuid,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists read_by jsonb not null default '[]'::jsonb;

update public.chat_messages
set sender_id = (data->>'sender_id')::uuid
where sender_id is null
  and data->>'sender_id' is not null
  and (data->>'sender_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create index if not exists idx_chat_messages_sender_id on public.chat_messages (sender_id);
