-- Signalé : "les Novadji dans les messages ne se mettent pas" — en creusant,
-- le bug est plus large et préexistant : la colonne `id` de
-- `public.chat_messages` (messages des canaux d'équipe #général...) n'a
-- AUCUNE valeur par défaut (`gen_random_uuid()` manquant), alors que le
-- code client (ancien `sendMessage` comme le nouveau bouton mascotte Nova)
-- n'a jamais fourni d'id explicite, comptant dessus. Chaque tentative
-- d'envoi de message dans un canal échouait donc silencieusement avec
-- "null value in column id violates not-null constraint" — confirmé par
-- une table entièrement vide (0 ligne) malgré des canaux existants
-- utilisés depuis longtemps.
alter table public.chat_messages
  alter column id set default gen_random_uuid();
