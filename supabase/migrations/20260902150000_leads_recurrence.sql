-- ─────────────────────────────────────────────────────────────────────────
-- « Récurrence » — demandé le 2 septembre pour Novavisio.
--
-- « Si on archive, ça serait bien qu'on ait deux cases différentes : la
--   commission de Natacha au-dessus de la commission de l'agence, et voir
--   pourquoi pas une troisième, récurrence de Natacha. Comme ça, sur un
--   dossier archivé, on pourra marquer les trois éléments différents à la
--   fin, et on pourra le marquer à la main tout simplement. »
--
-- Les deux premiers montants ont déjà leur colonne :
--   `estimated_value`        — commission de l'agence ;
--   `advisor_commission_ttc` — commission du conseiller, saisie TTC.
--
-- La récurrence, elle, n'est ni l'une ni l'autre : c'est ce qui revient
-- ensuite sur ce client (abonnement, prestation renouvelée). Elle a donc sa
-- propre colonne, sans quoi elle écraserait un montant qui sert ailleurs.
--
-- Aucune valeur par défaut : une fiche sans récurrence reste à NULL, ce qui
-- se distingue d'un zéro réellement saisi.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists recurring_amount numeric;

comment on column public.leads.recurring_amount is
  'Récurrence : montant qui revient sur ce client (abonnement, prestation renouvelée). Saisi à la main, notamment à l''archivage.';
