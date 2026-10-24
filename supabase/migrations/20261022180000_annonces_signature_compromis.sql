-- Ajoute le niveau d'annonce « signature_compromis » à côté de
-- « signature_acte ». Les annonces déjà publiées en signature_acte
-- restent inchangées : seule la liste autorisée s'élargit.
alter table public.announcements
  drop constraint if exists announcements_level_check;

alter table public.announcements
  add constraint announcements_level_check
  check (level in (
    'info',
    'a_verifier',
    'important',
    'succes',
    'veille',
    'reponse_demandee',
    'signature_compromis',
    'signature_acte'
  ));
