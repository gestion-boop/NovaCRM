-- Ticket "Clients invités" (1/13) : nouveau rôle app_role "client_guest",
-- totalement séparé de super_admin/commercial/intern — fondation du
-- portail client invité (voir tickets #138-149). Rien de visible pour
-- l'instant, juste la valeur d'enum disponible en base (même schéma que
-- l'ajout du rôle "intern" — migration 20260825190000_intern_role_enum.sql).
alter type app_role add value if not exists 'client_guest';
