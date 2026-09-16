-- Demande explicite (16 septembre) : « quand le consentement a été signé,
-- mets à jour sur la fiche du contact » — la signature se fait depuis la
-- page publique, hors session CRM (autre onglet/appareil) ; sans Realtime
-- sur cette table, une fiche déjà ouverte restait affichée avec l'ancien
-- statut tant qu'elle n'était pas rechargée à la main (voir l'abonnement
-- ajouté dans ClientProfileView.tsx).
alter publication supabase_realtime add table public.confidential_questionnaires;
