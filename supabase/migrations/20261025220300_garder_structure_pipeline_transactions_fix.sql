-- Signalé en revue (25 octobre, chasse aux bugs) : le trigger
-- garder_structure_pipeline_transactions() (20261022120000) avait deux
-- failles pour pipeline_stages.
--
-- 1. Sur un UPDATE de pipeline_stages, seul new.pipeline_id était vérifié.
--    N'importe quel membre ayant le droit RLS de modifier les étapes de son
--    agence pouvait donc faire
--    `update pipeline_stages set pipeline_id = '<son pipeline perso>' where
--    id = '<colonne de Transactions>'` : la colonne sortait de Transactions
--    sans que la règle « seuls Mélanie et Sylvain » ne bloque quoi que ce
--    soit, et les fiches de cette étape se retrouvaient rattachées à
--    l'autre pipeline. On vérifie maintenant aussi old.pipeline_id.
--
-- 2. Avec la clé service_role, auth.uid() vaut NULL. `NULL in (...)` vaut
--    NULL, et PL/pgSQL traite une condition IF nulle comme fausse : « if
--    not autorise » ne levait donc jamais l'exception. Toute route serveur
--    qui modifierait ces tables avec cette clé contournait la règle sans
--    bruit. `autorise` est maintenant forcé à `false` (jamais NULL) via
--    coalesce.
create or replace function public.garder_structure_pipeline_transactions()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cible_id uuid;
  cible_agence uuid;
  cible_nom text;
  ancien_id uuid;
  ancien_agence uuid;
  ancien_nom text;
  touche_transactions boolean;
  autorise boolean;
begin
  if tg_table_name = 'pipelines' then
    if tg_op = 'DELETE' then
      cible_id := old.id;
      cible_agence := old.agency_id;
      cible_nom := old.name;
      touche_transactions := public.est_pipeline_transactions(cible_id, cible_agence, cible_nom);
    else
      cible_id := new.id;
      cible_agence := new.agency_id;
      cible_nom := new.name;
      touche_transactions := public.est_pipeline_transactions(cible_id, cible_agence, cible_nom);
      if tg_op = 'UPDATE' and public.est_pipeline_transactions(old.id, old.agency_id, old.name) then
        touche_transactions := true;
      end if;
    end if;
  else
    -- pipeline_stages : on regarde le pipeline VISÉ (new.pipeline_id, ou
    -- old.pipeline_id pour un DELETE), ET, pour un UPDATE, l'ANCIEN
    -- pipeline aussi (voir point 1 ci-dessus).
    cible_id := case when tg_op = 'DELETE' then old.pipeline_id else new.pipeline_id end;
    select p.id, p.agency_id, p.name
      into cible_id, cible_agence, cible_nom
      from public.pipelines p
      where p.id = cible_id;
    touche_transactions := public.est_pipeline_transactions(cible_id, cible_agence, cible_nom);

    if tg_op = 'UPDATE' and new.pipeline_id is distinct from old.pipeline_id then
      select p.id, p.agency_id, p.name
        into ancien_id, ancien_agence, ancien_nom
        from public.pipelines p
        where p.id = old.pipeline_id;
      if public.est_pipeline_transactions(ancien_id, ancien_agence, ancien_nom) then
        touche_transactions := true;
      end if;
    end if;
  end if;

  if not touche_transactions then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and tg_table_name = 'pipelines' then
    raise exception 'Le pipeline Transactions ne peut pas être supprimé.';
  end if;

  autorise := coalesce(
    auth.uid() in (
      '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29'::uuid,
      '15bcec53-de3e-40b8-8b7e-bb6874836f29'::uuid
    ),
    false
  );
  if not autorise then
    raise exception 'Seul Mélanie ou Sylvain peut modifier le pipeline Transactions.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
