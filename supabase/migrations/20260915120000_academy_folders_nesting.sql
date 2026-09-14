-- Demande explicite (15 septembre) : « je veux créer des dossiers avec
-- des sous-dossiers pour ne pas se perdre » (Académy).
--
-- `academy_folders` (agency_id, nom) était déjà unique par agence — un nom
-- de dossier identifie donc sans ambiguïté un dossier, quel que soit son
-- niveau d'imbrication. `parent_nom` référence ce même couple : NULL pour
-- un dossier racine, sinon le nom de son dossier parent.
--
-- ON UPDATE CASCADE : renommer un dossier met à jour automatiquement le
-- `parent_nom` de ses sous-dossiers (le code applicatif renomme déjà à la
-- main la rubrique des ressources concernées, qui n'est pas liée par
-- contrainte — texte libre historique).
-- ON DELETE SET NULL : supprimer un dossier ne supprime PAS ses
-- sous-dossiers (même philosophie non destructive que pour les
-- ressources, qui rejoignent "Général") — ils remontent simplement à la
-- racine plutôt que de disparaître.
alter table public.academy_folders
  add column if not exists parent_nom text null;

alter table public.academy_folders
  add constraint academy_folders_parent_fkey
  foreign key (agency_id, parent_nom) references public.academy_folders (agency_id, nom)
  on update cascade on delete set null;

create index if not exists idx_academy_folders_parent on public.academy_folders (agency_id, parent_nom);
