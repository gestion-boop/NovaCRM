-- Ticket "Refonte fiche tâche" (5/6) : journal d'activité d'une tâche
-- (création, changements de statut/priorité/échéance/assignation).
-- Alimenté par un trigger sur internal_project_tasks plutôt que depuis
-- chaque point d'appel côté React (glisser-déposer, fiche tâche...) : garantit
-- qu'AUCUN changement n'échappe au journal, quel que soit le chemin emprunté.

create table if not exists public.internal_project_task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.internal_project_tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);

create index if not exists idx_internal_task_activity_task on public.internal_project_task_activity (task_id, created_at desc);

alter table public.internal_project_task_activity enable row level security;

create policy "internal_task_activity: select if task visible"
on public.internal_project_task_activity for select
to authenticated
using (
  exists (select 1 from public.internal_project_tasks t where t.id = internal_project_task_activity.task_id)
);

-- Écriture uniquement via le trigger ci-dessous (aucune policy insert pour
-- les utilisateurs — la fonction trigger tourne avec les droits du
-- propriétaire de la table, donc pas besoin d'ouvrir insert côté client).

create or replace function public.log_internal_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  status_labels jsonb := '{"a_faire":"À faire","en_cours":"En cours","a_verifier":"À vérifier","termine":"Terminé"}'::jsonb;
  priority_labels jsonb := '{"basse":"Basse","normale":"Normale","haute":"Haute","urgente":"Urgente"}'::jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into public.internal_project_task_activity (task_id, actor_id, action, to_value)
    values (new.id, new.created_by, 'created', new.title);
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.internal_project_task_activity (task_id, actor_id, action, from_value, to_value)
      values (new.id, auth.uid(), 'status_changed', status_labels ->> old.status, status_labels ->> new.status);
    end if;
    if new.priority is distinct from old.priority then
      insert into public.internal_project_task_activity (task_id, actor_id, action, from_value, to_value)
      values (new.id, auth.uid(), 'priority_changed', priority_labels ->> old.priority, priority_labels ->> new.priority);
    end if;
    if new.due_date is distinct from old.due_date then
      insert into public.internal_project_task_activity (task_id, actor_id, action, from_value, to_value)
      values (new.id, auth.uid(), 'due_date_changed', to_char(old.due_date, 'DD/MM/YYYY'), to_char(new.due_date, 'DD/MM/YYYY'));
    end if;
    if new.collaborator_ids is distinct from old.collaborator_ids then
      insert into public.internal_project_task_activity (task_id, actor_id, action, from_value, to_value)
      values (new.id, auth.uid(), 'collaborators_changed', array_length(old.collaborator_ids, 1)::text, array_length(new.collaborator_ids, 1)::text);
    end if;
    if new.title is distinct from old.title then
      insert into public.internal_project_task_activity (task_id, actor_id, action, from_value, to_value)
      values (new.id, auth.uid(), 'title_changed', old.title, new.title);
    end if;
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_log_internal_task_activity_insert on public.internal_project_tasks;
create trigger trg_log_internal_task_activity_insert
after insert on public.internal_project_tasks
for each row execute function public.log_internal_task_activity();

drop trigger if exists trg_log_internal_task_activity_update on public.internal_project_tasks;
create trigger trg_log_internal_task_activity_update
after update on public.internal_project_tasks
for each row execute function public.log_internal_task_activity();

alter publication supabase_realtime add table public.internal_project_task_activity;
