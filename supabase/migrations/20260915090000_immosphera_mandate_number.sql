-- Demande explicite (15 septembre, Immosphera360) : « pouvoir rentrer le
-- numéro de mandat [...] et ce numéro-là sera affiché sur la carte du
-- Bien principal en bas à droite, qui permettra d'identifier le Bien pour
-- la visite au casque car ceci sont répertoriés par numéro de mandat ».
alter table public.immosphera_properties
  add column if not exists mandate_number text;

comment on column public.immosphera_properties.mandate_number is
  'Numéro de mandat de l''agence — sert à identifier le bien pour la visite au casque VR (répertoriés par numéro de mandat).';
