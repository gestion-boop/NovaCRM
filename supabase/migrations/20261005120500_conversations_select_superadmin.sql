-- Même besoin que la policy précédente (messages_select_superadmin),
-- pour la même raison : "Members view entity conversations" ne teste que
-- is_conversation_member(), qui exige une ligne dans conversation_members
-- même pour un super admin (le bypass de is_agency_member() qu'elle
-- appelle ne joue qu'EN PLUS de cette exigence, jamais à sa place).
--
-- Sans cette policy, le bouton "Documents" (accès global aux pièces
-- jointes pour les super admins) perdrait le titre ET l'agence de toute
-- conversation dont l'administrateur n'est pas lui-même membre — les
-- documents de ces conversations, pourtant désormais lisibles via
-- messages_select_superadmin, seraient filtrés à tort faute de pouvoir
-- vérifier leur agence.
create policy "conversations_select_superadmin"
on public.conversations
for select
using (has_role(auth.uid(), 'super_admin'::app_role));
