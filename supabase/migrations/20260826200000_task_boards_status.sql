-- Demande urgente : "Pipeline interne" (Projets internes) doit devenir un
-- vrai tableau à 4 colonnes (À faire / En cours / Terminé / Archivé), avec
-- glisser-déposer pour changer le statut d'un projet/liste. Le statut
-- affiché côté client était jusqu'ici entièrement cosmétique : `task_boards`
-- n'avait AUCUNE colonne `status`, chaque projet était donc rechargé avec
-- "En cours" codé en dur (voir ProjetsInternes.tsx, loadProjects) — tout
-- changement de statut était perdu au rechargement suivant.
alter table public.task_boards
  add column if not exists status text not null default 'a_faire'
  check (status in ('a_faire', 'en_cours', 'termine', 'archive'));
