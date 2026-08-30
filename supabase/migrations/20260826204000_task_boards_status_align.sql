-- Correction demandée : le tableau "Projet" (Pipeline interne, task_boards)
-- doit utiliser exactement le même système de statuts/couleurs que le
-- tableau des tâches d'un projet (InternalProjectBoard.tsx, InternalTaskStatus)
-- : à faire / en cours / à vérifier / terminé — pas un système différent
-- inventé pour ce ticket (à faire/en cours/terminé/archivé).
alter table public.task_boards drop constraint if exists task_boards_status_check;
alter table public.task_boards add constraint task_boards_status_check
  check (status in ('a_faire', 'en_cours', 'a_verifier', 'termine'));

-- Toute carte existante en 'archive' (créée pendant la courte fenêtre où
-- l'ancien système était en place) repasse en 'termine', le plus proche
-- équivalent — jamais de perte de carte silencieuse.
update public.task_boards set status = 'termine' where status = 'archive';
