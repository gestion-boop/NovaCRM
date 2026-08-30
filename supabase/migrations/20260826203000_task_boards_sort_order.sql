-- Demande urgente : réordonner verticalement les cartes À L'INTÉRIEUR d'une
-- même colonne du tableau "Pipeline interne" (en plus du glisser-déposer
-- horizontal entre colonnes déjà en place) — nécessite un ordre persistant,
-- qui n'existait pas (les cartes n'étaient triées que par date de mise à
-- jour, jamais par position choisie manuellement).
alter table public.task_boards add column if not exists sort_order integer not null default 0;

-- Ticket "Paramètres/Nova/Utilisateurs/Annonces" (7/16) : la déconnexion
-- forcée en temps réel (AuthContext.tsx) a besoin que `profiles` diffuse
-- ses changements — absent de la publication realtime jusqu'ici.
alter publication supabase_realtime add table public.profiles;
