-- Ticket #242 : deux pancartes spéciales supplémentaires — "Réponse
-- demandée SVP" et "Signature d'un acte" — en plus des 5 niveaux du ticket
-- #241. Le "Sondage" n'a pas besoin d'une nouvelle valeur de `level` : il
-- réutilise le flag `is_poll` déjà existant (case "Transformer en sondage"
-- du composeur d'annonces), qui prend visuellement le dessus sur le niveau
-- choisi.
alter table public.announcements
  drop constraint if exists announcements_level_check;

alter table public.announcements
  add constraint announcements_level_check
  check (level in ('info', 'a_verifier', 'important', 'succes', 'veille', 'reponse_demandee', 'signature_acte'));
