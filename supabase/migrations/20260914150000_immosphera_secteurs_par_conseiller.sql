-- Demande explicite (14 septembre, en repensant la première version) :
-- « dans les équipes, c'est-à-dire dans les fiches des agents immobiliers,
-- on puisse définir des secteurs par exemple 11100, 11160, 11230 [...] avec
-- pourquoi pas dans un premier temps des couleurs, par exemple Laetitia
-- aurait un tracé jaune, Isabelle un tracé vert. »
--
-- Remplace le polygone dessiné à la main (jamais utilisé — aucune ligne en
-- base) par une liste de codes postaux, UN secteur par conseiller plutôt
-- qu'un polygone partagé entre plusieurs. `conseiller_id` référence le même
-- id statique que src/immosphera/lib/advisors.ts (ex. "laetitia").
alter table public.immosphera_secteurs
  drop column if exists polygone,
  drop column if exists conseiller_ids,
  drop column if exists nom;

alter table public.immosphera_secteurs
  add column if not exists conseiller_id text not null,
  add column if not exists codes_postaux text[] not null default '{}';

alter table public.immosphera_secteurs
  add constraint immosphera_secteurs_conseiller_unique unique (agency_id, conseiller_id);
