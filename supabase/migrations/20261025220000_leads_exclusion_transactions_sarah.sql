-- Signalé en revue (25 octobre, chasse aux bugs) : pipelineVisiblePour
-- (src/lib/pipelinesAcces.ts) cache le pipeline « Transactions » à Sarah
-- uniquement dans le menu côté client. Côté serveur, la policy
-- "leads: lecture par les membres de l'agence" (20260920100000) donne la
-- lecture à tout membre de l'agence dès que pipeline_id = Transactions,
-- sans aucune exception pour Sarah : son navigateur télécharge donc déjà
-- toutes les fiches Transactions (nom, téléphone, e-mail, budget,
-- commissions, mandat) à chaque chargement, sans manipulation nécessaire.
--
-- Policy RESTRICTIVE (combinée en ET avec TOUTES les policies SELECT
-- existantes sur leads, y compris "Owner assignee guest views leads") pour
-- exclure Sarah sans toucher aux autres règles de lecture déjà en place.
create policy "leads: exclusion transactions pour Sarah"
on public.leads
as restrictive
for select
using (
  not (
    pipeline_id = '8f79d05c-d191-43bb-8323-bedbd722f9f2'::uuid
    and (select auth.uid()) = '3fd7bce8-cdd5-471c-96df-67c10a55d4b6'::uuid
  )
);
