-- ─────────────────────────────────────────────────────────────────────────
-- Tuiles d'accueil masquées : la liste suit le compte.
--
-- Demandé le 2 septembre : « je suis utilisateur lambda ; lors d'une mise à
-- jour, je ne veux pas que des tuiles réapparaissent, je veux que ça
-- sauvegarde mon interface ».
--
-- La grille d'accueil est déjà synchronisée par compte (home_tiles), mais la
-- liste des tuiles masquées ne l'était pas : elle restait dans le navigateur.
-- Sur un autre poste, la grille revenait SANS cette liste, et tout ce qui
-- avait été masqué ressortait — vécu comme « la mise à jour a remis mes
-- tuiles ». La liste rejoint donc les réglages du compte.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.user_ui_settings
  add column if not exists hidden_tiles jsonb not null default '[]'::jsonb;

comment on column public.user_ui_settings.hidden_tiles is
  'Tuiles d''accueil masquées par l''utilisateur (récupérables dans Paramètres). Suit le compte, pas le navigateur.';
