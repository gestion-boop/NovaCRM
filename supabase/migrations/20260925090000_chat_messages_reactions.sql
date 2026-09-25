-- Signalé (25/09/2026, capture à l'appui, canal "Nouveautés (biens)") :
-- « les utilisateurs ne peuvent pas rajouter [de réaction] sur les textes
-- qui sont postés, [ils sont] obligés de faire un message à part [...]
-- comme ça se fait déjà dans notre interface ». Les réactions existent déjà
-- pour les conversations directes (`message_reactions`, table à part liée à
-- `messages`), mais les canaux d'équipe vivent dans une table différente
-- (`chat_messages`, colonne `channel` en texte, pas de conversation_id ni
-- channel_id) : `message_reactions` ne peut donc pas s'y appliquer. Même
-- principe déjà en place sur cette table pour `read_by` (JSONB, mise à jour
-- directement sur la ligne) : `reactions` suit le même modèle plutôt que
-- d'introduire une seconde table de réactions.
--
-- Aucune nouvelle policy nécessaire : "Chat messages: update by project
-- member" autorise déjà tout membre du dossier qui peut voir ce canal à
-- modifier la ligne (c'est cette même policy qui permet déjà à n'importe
-- qui de marquer `read_by`, pas seulement l'auteur) — exactement le
-- comportement voulu pour une réaction ("tout membre du canal peut réagir").

alter table public.chat_messages
  add column if not exists reactions jsonb not null default '[]'::jsonb;
