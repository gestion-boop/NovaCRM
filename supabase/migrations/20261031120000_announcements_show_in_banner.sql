-- Demande explicite (31 octobre) : refonte de l'écran Annonces + ajout d'un
-- bandeau défilant optionnel qui remplace la barre du haut (tablette/
-- ordinateur) tant qu'il n'a pas été fermé via « OK ». Ce drapeau, par
-- annonce, décide si elle s'affiche AUSSI en bandeau en plus du message
-- plein écran existant (AnnouncementBanner.tsx, inchangé).
alter table public.announcements add column if not exists show_in_banner boolean not null default false;
