-- Signalé : "quand je veux créer un nouveau projet, je ne peux pas
-- l'affilier à un Stagiaire" — le sélecteur "Responsable" existait déjà
-- côté interface (ProjetsInternes.tsx) mais n'avait aucune colonne pour
-- être réellement enregistré : la création d'un projet écrivait
-- systématiquement created_by = créateur du projet, quelle que soit la
-- personne choisie dans le menu déroulant, qui était donc purement
-- décorative.
alter table public.task_boards
  add column if not exists assigned_user_id uuid references public.profiles(id) on delete set null;

comment on column public.task_boards.assigned_user_id is
  'Responsable désigné du projet (choisi à la création) — distinct de created_by (qui a créé le projet). Peut être un stagiaire.';
