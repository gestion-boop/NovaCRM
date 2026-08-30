-- Masquage (réversible) de tous les biens Immosphera360 existants, à la
-- demande explicite de Sylvain : "on va masquer tous les biens... pour faire
-- un test réel en repartant de zéro" — sans les supprimer, pour pouvoir s'en
-- resservir plus tard (il suffira de repasser hidden_at à null).
alter table public.immosphera_properties
  add column if not exists hidden_at timestamptz;

update public.immosphera_properties
  set hidden_at = now()
  where hidden_at is null;
