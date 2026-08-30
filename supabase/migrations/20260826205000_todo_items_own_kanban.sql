-- Correction demandée : "Liste" doit être un tableau kanban INDÉPENDANT,
-- avec sa propre interface — pas une simple checklist à cocher qui
-- alimente le tableau de "Projet". On remplace le simple booléen `is_done`
-- par un vrai statut à 3 colonnes (À faire / En cours / Fait), propre à
-- cette liste, sans aucun lien avec task_boards.
alter table public.internal_todo_items add column if not exists status text not null default 'a_faire'
  check (status in ('a_faire', 'en_cours', 'fait'));

update public.internal_todo_items set status = 'fait' where is_done = true and status = 'a_faire';

alter table public.internal_todo_items drop column if exists is_done;

alter table public.internal_todo_items add column if not exists sort_order integer not null default 0;
