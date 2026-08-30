-- Ticket #241 : passage du bandeau d'annonces Nova à 5 niveaux (au lieu de
-- 3) — Information/or, À vérifier/ambre, Important/rouge, Succès/vert,
-- Veille/bleu — chacun avec sa propre mascotte Nova et sa propre couleur.
-- Le nom de contrainte auto-généré par Postgres pour un `check` inline sur
-- une colonne ajoutée par `alter table ... add column` suit le schéma
-- `<table>_<column>_check` ; celui posé par la migration précédente
-- (20260826212000_announcements_levels.sql) est donc `announcements_level_check`.
-- Ancien niveau 'urgent' : remappé sur 'important' (le plus proche
-- sémantiquement — lecture obligatoire, couleur rouge) pour ne perdre
-- aucune annonce existante lors du passage aux 5 niveaux. Fait AVANT de
-- reposer la contrainte ci-dessous : sinon, la moindre ligne encore à
-- 'urgent' fait échouer l'`add constraint` (23514) avant même d'être remappée.
update public.announcements set level = 'important' where level = 'urgent';

-- 'reponse_demandee' et 'signature_acte' (ticket #242, migration suivante
-- 20260827150000_announcements_special_levels.sql) sont déjà utilisés par
-- l'agent IA (api/ai/agent.ts, create_announcement) et donc déjà présents
-- dans des lignes existantes au moment où cette migration s'exécute — on
-- les inclut ici aussi pour que l'`add constraint` ne rejette pas des
-- annonces réelles déjà en base (23514). La migration suivante reposera la
-- même contrainte sans effet, une fois les deux niveaux spéciaux introduits
-- formellement.
alter table public.announcements
  drop constraint if exists announcements_level_check;

alter table public.announcements
  add constraint announcements_level_check
  check (level in ('info', 'a_verifier', 'important', 'succes', 'veille', 'reponse_demandee', 'signature_acte'));
