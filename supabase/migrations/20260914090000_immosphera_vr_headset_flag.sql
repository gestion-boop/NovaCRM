-- Demande explicite (14 septembre, Immosphera360) : « possibilité de mettre
-- un logo de casque quand la visite virtuelle est faite, cela confirmera
-- que c'est bien disponible au casque VR » + case à cocher « Casque VR
-- disponible » dans la fiche d'un Bien, affichée sur la carte principale.
alter table public.immosphera_properties
  add column if not exists vr_headset_available boolean not null default false;

comment on column public.immosphera_properties.vr_headset_available is
  'Coché manuellement par l''agent : la visite virtuelle de ce bien est aussi consultable au casque VR (indépendant de virtual_tour_url, qui peut exister sans compatibilité casque).';
