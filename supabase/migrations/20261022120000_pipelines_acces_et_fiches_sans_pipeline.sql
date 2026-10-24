-- Accès aux pipelines (22 octobre).
--
-- 1. Un pipeline supprimé ne doit plus réaffecter ses contacts vers un autre
--    pipeline. Ils restent des fiches, sans pipeline ni colonne. Les colonnes
--    étaient peut-être obligatoires : on les rend facultatives pour que cette
--    mise à jour puisse aboutir. `drop not null` ne change rien si c'est déjà
--    le cas.
--
-- 2. « Pipelines Transactions » (Immosphera) : personne ne le supprime.
--    Titre, colonnes et leur ordre : uniquement Mélanie Grazia et Sylvain
--    Grazia. Le déplacement d'une fiche d'une colonne à l'autre écrit dans
--    `leads`, pas dans ces tables : il n'est pas touché.

alter table public.leads alter column pipeline_id drop not null;
alter table public.leads alter column stage_id drop not null;

create or replace function public.est_pipeline_transactions(p_id uuid, p_agency uuid, p_name text)
returns boolean
language sql
immutable
as $$
  select
    p_id = '8f79d05c-d191-43bb-8323-bedbd722f9f2'::uuid
    or (
      p_agency = '15157da9-71ea-4760-ae1c-3bc99d9caa20'::uuid
      and translate(lower(coalesce(p_name, '')), 'àâäéèêëïîôùûüç', 'aaaeeeeiioouuuc')
        ~ '(^|[^a-z])pipelines?[[:space:]]+transactions([^a-z]|$)'
    );
$$;

create or replace function public.garder_structure_pipeline_transactions()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cible_id uuid;
  cible_agence uuid;
  cible_nom text;
  autorise boolean;
begin
  if tg_table_name = 'pipelines' then
    if tg_op = 'DELETE' then
      cible_id := old.id;
      cible_agence := old.agency_id;
      cible_nom := old.name;
    else
      cible_id := new.id;
      cible_agence := new.agency_id;
      cible_nom := new.name;
      if tg_op = 'UPDATE' and public.est_pipeline_transactions(old.id, old.agency_id, old.name) then
        cible_id := old.id;
        cible_agence := old.agency_id;
        cible_nom := old.name;
      end if;
    end if;
  else
    cible_id := case when tg_op = 'DELETE' then old.pipeline_id else new.pipeline_id end;
    select p.id, p.agency_id, p.name
      into cible_id, cible_agence, cible_nom
      from public.pipelines p
      where p.id = cible_id;
  end if;

  if not public.est_pipeline_transactions(cible_id, cible_agence, cible_nom) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and tg_table_name = 'pipelines' then
    raise exception 'Le pipeline Transactions ne peut pas être supprimé.';
  end if;

  autorise := auth.uid() in (
    '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29'::uuid,
    '15bcec53-de3e-40b8-8b7e-bb6874836f29'::uuid
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

drop trigger if exists pipelines_transactions_structure on public.pipelines;
create trigger pipelines_transactions_structure
  before insert or update or delete on public.pipelines
  for each row
  execute function public.garder_structure_pipeline_transactions();

drop trigger if exists pipeline_stages_transactions_structure on public.pipeline_stages;
create trigger pipeline_stages_transactions_structure
  before insert or update or delete on public.pipeline_stages
  for each row
  execute function public.garder_structure_pipeline_transactions();
