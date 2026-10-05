-- Un super admin peut déjà SUPPRIMER n'importe quel message (voir la
-- policy "messages_delete_superadmin") et LIRE n'importe quel message de
-- canal (chat_messages, "Chat messages: select by project member" inclut
-- déjà has_role(..., 'super_admin')) — mais pas encore LIRE les messages
-- de conversations dont il n'est pas membre : "Members view messages" ne
-- teste que is_conversation_member / can_access_chat_project, sans
-- équivalent pour le rôle super_admin.
--
-- Nécessaire pour le bouton "Documents" (5 octobre 2026, accès global aux
-- pièces jointes de la Messagerie pour les super admins) : sans cette
-- policy, la recherche ne remonterait que les conversations dont
-- l'administrateur fait lui-même partie, pas un accès réellement global.
--
-- Policy additive (jamais de AND avec l'existante : Postgres additionne
-- les policies permissives d'un même SELECT avec un OR) — n'enlève rien à
-- personne, n'élargit que les super admins.
create policy "messages_select_superadmin"
on public.messages
for select
using (has_role(auth.uid(), 'super_admin'::app_role));
