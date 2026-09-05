-- ─────────────────────────────────────────────────────────────────────────
-- Conseils Finances, 5 septembre : « il n'y a pas de hors taxes dans
-- Conseils Finances, c'est que du TTC. Et mets à jour les fiches clients
-- déjà existantes par rapport aux montants. »
--
-- Depuis le 31 août, le formulaire de la fiche divisait par 1,2 le montant
-- saisi dans « Commission agence (€ TTC) » avant de l'enregistrer dans
-- `leads.estimated_value` (règle ImmoSphera : saisie TTC, base en HT). Sur
-- Conseils Finances, cette division n'a pas lieu d'être : l'application ne
-- la fait plus, et ce script remet à leur valeur TTC les honoraires déjà
-- enregistrés (× 1,2).
--
-- À JOUER UNE SEULE FOIS, et seulement après avoir regardé l'aperçu : les
-- fiches importées de l'ancien CRM avec un montant déjà TTC ne doivent
-- pas être multipliées. L'aperçu (étape 1) liste ce qui serait touché.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Étape 1 : aperçu — rien n'est modifié ───────────────────────────────
select
  l.id,
  l.full_name,
  l.estimated_value                                 as honoraires_actuels,
  round((l.estimated_value * 1.2)::numeric, 2)      as honoraires_apres,
  l.archived_at is not null                         as archivee,
  l.created_at,
  l.updated_at
from public.leads l
where l.agency_id = '30f96ea9-41da-41c2-a95e-f5e7898f8d8e'   -- Conseils Finances
  and l.estimated_value is not null
  and l.estimated_value > 0
  and l.deleted_at is null
order by l.updated_at desc;

-- ── Étape 2 : la remise en TTC (× 1,2), à ne lancer qu'après l'aperçu ────
-- Décommenter le bloc pour l'exécuter. Un seul passage : relancé deux fois,
-- il multiplierait deux fois.
--
-- update public.leads
-- set estimated_value = round((estimated_value * 1.2)::numeric, 2),
--     updated_at = now()
-- where agency_id = '30f96ea9-41da-41c2-a95e-f5e7898f8d8e'
--   and estimated_value is not null
--   and estimated_value > 0
--   and deleted_at is null;
