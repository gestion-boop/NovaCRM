-- ─────────────────────────────────────────────────────────────────────────
-- Académy — image de fond de l'écran, demandée le 2 septembre.
--
-- « Voilà ce que je voudrais que tu mettes dans ImmoSphera Académie en fond
--   d'écran, et par-dessus on pourra mettre les dossiers qui sont alignés. »
--
-- L'image est propre à chaque société : elle porte son logo et son identité.
-- Elle se range donc à côté des autres réglages d'apparence de l'agence
-- (agency_ui_settings), et non dans le code — sans quoi il faudrait une
-- livraison à chaque changement de visuel.
--
-- Le fichier lui-même va dans le compartiment « academy », déjà créé pour les
-- couvertures (migration 20260902180000).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.agency_ui_settings
  add column if not exists academy_background_url text;

comment on column public.agency_ui_settings.academy_background_url is
  'Image de fond de l''écran Académy pour cette société.';
