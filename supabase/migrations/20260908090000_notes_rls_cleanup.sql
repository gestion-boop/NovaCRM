-- Audit demandé le 8 septembre (« chaque utilisateur doit voir ses propres
-- rappels, notes et contacts ») : les tables reminders/tasks/leads étaient
-- déjà correctement cloisonnées (par propriétaire, ou par agence pour les
-- fiches client, partagées en équipe comme attendu dans un CRM).
--
-- `notes`, en revanche, avait TROIS règles héritées d'un ancien test
-- (`notes_insert_authenticated`, `notes_update_authenticated`,
-- `notes_delete_authenticated`, toutes `USING/WITH CHECK true`) qui
-- coexistaient avec les bonnes règles restrictives — en RLS Postgres,
-- plusieurs règles permissives pour une même commande s'additionnent (OR) :
-- N'IMPORTE QUEL utilisateur connecté pouvait donc modifier ou supprimer
-- la note de n'importe qui, toute agence confondue, malgré la règle
-- correcte affichée à côté dans le tableau des policies. Supprimées : la
-- confidentialité (propriétaire, ou personne mentionnée en lecture seule)
-- est maintenant réellement appliquée.

drop policy if exists "notes_insert_authenticated" on public.notes;
drop policy if exists "notes_update_authenticated" on public.notes;
drop policy if exists "notes_delete_authenticated" on public.notes;
