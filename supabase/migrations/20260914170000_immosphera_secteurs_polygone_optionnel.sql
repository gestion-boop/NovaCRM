-- Demande explicite (14 septembre) : « pourquoi pas dessiner un secteur
-- aussi sur la carte qui englobe pas mal de codes postaux » — en plus du
-- choix de communes (autocomplete, voir geo.ts/rechercherCommunes), un
-- admin peut désormais dessiner un contour libre par-dessus, pour affiner
-- ou étendre visuellement au-delà des cercles par commune. Nullable :
-- optionnel, la plupart des secteurs n'auront qu'une liste de communes.
alter table public.immosphera_secteurs add column if not exists polygone jsonb null;
