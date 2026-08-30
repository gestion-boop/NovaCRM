-- Deux champs demandés sur les fiches clients, absents de la table `leads`.
--
-- 1. `mandate_number` — le numéro de mandat. Demandé pour que les fenêtres
--    de détail des statistiques (clic sur une case Offre / Compromis /
--    Signature) puissent lister « Mandat : … » à côté de la ville. La ville
--    existe déjà : c'est la colonne `sector`.
--
-- 2. `advisor_commission_ttc` — la commission du conseiller immobilier,
--    saisie TTC par les conseillers. Le montant hors taxes est calculé à
--    l'affichage (pipeline, statistiques) plutôt que stocké, pour qu'un
--    changement de taux ne fausse pas l'historique.
--
--    Même logique pour le chiffre d'affaires de l'agence : il reste dans
--    `estimated_value` (le champ « Honoraires » de la fiche), saisi TTC.
--
-- Aucune valeur par défaut : les fiches existantes restent à NULL, ce qui se
-- distingue d'un vrai zéro saisi.

alter table public.leads
  add column if not exists mandate_number text,
  add column if not exists advisor_commission_ttc numeric;

comment on column public.leads.mandate_number is
  'Numéro de mandat, affiché dans le détail des statistiques.';
comment on column public.leads.advisor_commission_ttc is
  'Commission du conseiller immobilier, saisie TTC. Le HT est calculé à l''affichage.';
