-- Demande explicite (16 septembre) : « en tant que admin je puisse faire
-- un drag and drop dans les dossiers pour que les sous dossiers se
-- mettent. Et dans les sous dossiers, je veux pouvoir aussi les mettre
-- dans l'ordre que je veux. »
--
-- `position` — même principe que academy_resources.position, déjà en
-- place — permet un ordre manuel entre dossiers de MÊME parent (les
-- ressources ont toujours eu ça ; les dossiers, eux, n'étaient triés que
-- par ordre alphabétique jusqu'ici).
alter table public.academy_folders add column if not exists position integer not null default 0;
