-- Ticket "Paramètres/Nova/Utilisateurs/Annonces" (5/16) : invitation
-- stagiaire enrichie — en plus des dates début/fin déjà appliquées
-- (AuthContext.tsx, bloque la connexion hors fenêtre), on ajoute les
-- modules auxquels le stagiaire a accès (au-delà d'Accueil + son pipeline,
-- toujours inclus) et un champ libre pour toute restriction particulière
-- notée par l'admin à l'intention du responsable.
alter table public.intern_details
  add column if not exists allowed_modules text[] not null default '{}',
  add column if not exists special_rights text;
