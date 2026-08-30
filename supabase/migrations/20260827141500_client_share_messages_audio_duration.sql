-- Ticket #252 : le chat d'un dossier client partagé (client_share_messages)
-- permet d'envoyer un message vocal (audio_url + audio_duration, cf.
-- ClientProfileView.tsx `insertChatMessage`) mais la colonne
-- `audio_duration` n'existait pas sur cette table côté base — l'insertion
-- échouait avec "Could not find the 'audio_duration' column ... in the
-- schema cache".
alter table public.client_share_messages
  add column if not exists audio_duration integer;
