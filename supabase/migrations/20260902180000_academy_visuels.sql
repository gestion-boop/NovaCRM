-- ─────────────────────────────────────────────────────────────────────────
-- Académy — présentation « catalogue de formations », demandée le 2 septembre
-- (référence fournie : academie.modelo.fr).
--
-- « Est-ce qu'on ne pourrait pas faire une présentation comme ça, que cela ne
--   fasse pas trop intelligence artificielle ? »
--
-- Ce qui fait la différence sur cette référence n'est pas la mise en page :
-- c'est qu'on y voit des PHOTOS et des AUTEURS. Une fiche portée par une
-- personne et une image de métier se lit comme une formation ; la même fiche
-- réduite à une icône colorée se lit comme un dossier informatique.
--
--   image_url        — la photo de couverture de la fiche ;
--   auteur           — qui la signe (« Dorothée de Saintloup ») ;
--   auteur_photo_url — son portrait, rond, en bas de la fiche.
--
-- Les images vivent dans un compartiment de stockage dédié, PUBLIC en
-- lecture : une photo de couverture doit s'afficher sans négociation, et
-- aucune donnée client ne s'y trouve. L'écriture, elle, reste réservée aux
-- super admins, comme le reste de l'Académy.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.academy_resources
  add column if not exists image_url text,
  add column if not exists auteur text,
  add column if not exists auteur_photo_url text;

comment on column public.academy_resources.image_url is
  'Photo de couverture affichée en haut de la fiche.';
comment on column public.academy_resources.auteur is
  'Personne qui signe la procédure, affichée en bas de la fiche.';

-- Compartiment de stockage des visuels.
insert into storage.buckets (id, name, public)
values ('academy', 'academy', true)
on conflict (id) do update set public = true;

drop policy if exists "academy visuels : lecture publique" on storage.objects;
create policy "academy visuels : lecture publique" on storage.objects
for select
using (bucket_id = 'academy');

drop policy if exists "academy visuels : dépôt par les super admins" on storage.objects;
create policy "academy visuels : dépôt par les super admins" on storage.objects
for insert to authenticated
with check (bucket_id = 'academy' and has_role(auth.uid(), 'super_admin'::app_role));

drop policy if exists "academy visuels : remplacement par les super admins" on storage.objects;
create policy "academy visuels : remplacement par les super admins" on storage.objects
for update to authenticated
using (bucket_id = 'academy' and has_role(auth.uid(), 'super_admin'::app_role))
with check (bucket_id = 'academy' and has_role(auth.uid(), 'super_admin'::app_role));

drop policy if exists "academy visuels : suppression par les super admins" on storage.objects;
create policy "academy visuels : suppression par les super admins" on storage.objects
for delete to authenticated
using (bucket_id = 'academy' and has_role(auth.uid(), 'super_admin'::app_role));
