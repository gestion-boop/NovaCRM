-- ─────────────────────────────────────────────────────────────────────────
-- « CA devis à venir » — demandé le 2 septembre pour Novavisio.
--
-- « Je veux que tu rajoutes sur le tableau de bord une autre case avec CA
--   devis à venir ; cette information tu devras la chercher dans la fiche
--   client, car dans celle-ci tu devras créer juste une petite case CA devis
--   à venir pour marquer le montant. »
--
-- Un devis envoyé n'est ni une affaire gagnée (elle n'est pas signée) ni un
-- budget client (colonne `budget`) : il lui faut sa propre colonne, sans quoi
-- le montant écraserait une donnée qui sert déjà ailleurs.
--
-- Montant TTC ou HT ? Le devis se saisit tel qu'il est envoyé au client,
-- c'est-à-dire TTC — le tableau de bord l'affiche donc tel quel, séparé du
-- chiffre d'affaires réalisé, qui lui reste en HT.
--
-- Aucune valeur par défaut : une fiche sans devis reste à NULL, ce qui se
-- distingue d'un zéro réellement saisi.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists pending_quote_amount numeric;

comment on column public.leads.pending_quote_amount is
  'CA devis à venir : montant du devis envoyé au client, en attente de signature.';
