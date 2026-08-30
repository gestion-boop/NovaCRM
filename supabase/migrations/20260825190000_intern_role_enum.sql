-- Ticket "Rôle Stagiaire" (phase 2) : le rôle 'intern' est déjà attendu
-- partout côté code (server.ts AppRole, ParametresView.tsx — sélecteurs
-- "Stagiaire" déjà présents dans 3 formulaires) mais l'enum Postgres
-- `app_role` ne connaît toujours que 'super_admin' et 'commercial' — toute
-- tentative de créer un utilisateur avec ce rôle échoue silencieusement
-- depuis le début. Ajout de la seule valeur manquante, sans rien changer
-- d'autre.
alter type public.app_role add value if not exists 'intern';
