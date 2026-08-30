-- Ticket "Inviter un collaborateur" (#166) : "e-mail de carte de visite"
-- (facultatif) — une adresse distincte de l'e-mail de connexion, affichée
-- sur la carte de visite numérique du collaborateur (`business_cards`
-- existant reste inchangé : ce sont les fichiers/URLs de carte, pas
-- l'adresse e-mail à y afficher).
alter table public.profiles add column if not exists business_card_email text;
