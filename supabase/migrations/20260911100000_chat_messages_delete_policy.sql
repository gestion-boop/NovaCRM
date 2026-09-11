-- Signalé (11 septembre, Sylvain) : « sur desktop, impossible de supprimer
-- le message, dans les 3 entités cela ne marche pas ».
--
-- Cause trouvée en relisant les policies RLS de `chat_messages` (table des
-- messages de CANAUX D'ÉQUIPE, partagée par les 3 agences) : aucune policy
-- DELETE n'existait pour cette table — ni permissive ni autre chose qu'une
-- policy RESTRICTIVE (client_guest_lockdown_chat_messages, qui ne fait que
-- RÉTRÉCIR un accès déjà accordé ailleurs, jamais en accorder un). Sans
-- policy PERMISSIVE pour la commande DELETE, PostgreSQL la refuse purement
-- et simplement pour tout le monde, super_admin compris — d'où l'échec
-- identique observé dans les 3 agences (elles partagent la même table).
--
-- Le correctif appliqué le 11/09 côté client (ChatViewSupabase.tsx,
-- handleDeleteChannelMsg) — lire l'erreur de `.delete()` au lieu de
-- l'ignorer — reste juste : c'est lui qui a rendu ce refus visible/
-- diagnosticable plutôt que silencieux. Mais la vraie cause est ici, côté
-- base : sans cette policy, la suppression échoue TOUJOURS, quel que soit
-- le compte.
--
-- La table `messages` (conversations directes), elle, avait déjà ses
-- policies DELETE ("Author or admin deletes message" etc.) — seule
-- `chat_messages` avait cet oubli. Même règle que le bouton (voir
-- ChatViewSupabase.tsx, isAdmin) : l'auteur du message, ou un admin/
-- super_admin.
create policy "Chat messages: delete by author or admin"
  on public.chat_messages
  for delete
  using (
    sender_id = auth.uid()
    or has_role(auth.uid(), 'super_admin'::app_role)
    or has_role(auth.uid(), 'admin'::app_role)
  );
