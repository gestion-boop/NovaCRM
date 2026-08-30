-- Ticket "Rôle Stagiaire" (phase 2) : un stagiaire ne doit voir/modifier
-- QUE les tâches qui lui sont attribuées (collaborator_ids), jamais
-- l'ensemble des tâches de l'agence comme un collaborateur normal — sans
-- ça, "voit uniquement ses tâches" ne serait qu'une consigne d'interface,
-- pas une vraie restriction de sécurité.

drop policy if exists "internal_project_tasks: select by agency member" on public.internal_project_tasks;
create policy "internal_project_tasks: select by agency member"
on public.internal_project_tasks for select
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or (
    not public.has_role(auth.uid(), 'intern'::app_role)
    and exists (
      select 1 from public.agency_members m
      where m.agency_id = internal_project_tasks.agency_id
        and m.user_id = auth.uid()
    )
  )
  or auth.uid() = any(internal_project_tasks.collaborator_ids)
  or internal_project_tasks.created_by = auth.uid()
);

drop policy if exists "internal_project_tasks: update by agency member" on public.internal_project_tasks;
create policy "internal_project_tasks: update by agency member"
on public.internal_project_tasks for update
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or (
    not public.has_role(auth.uid(), 'intern'::app_role)
    and exists (
      select 1 from public.agency_members m
      where m.agency_id = internal_project_tasks.agency_id
        and m.user_id = auth.uid()
    )
  )
  or auth.uid() = any(internal_project_tasks.collaborator_ids)
  or internal_project_tasks.created_by = auth.uid()
)
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or (
    not public.has_role(auth.uid(), 'intern'::app_role)
    and exists (
      select 1 from public.agency_members m
      where m.agency_id = internal_project_tasks.agency_id
        and m.user_id = auth.uid()
    )
  )
  or auth.uid() = any(internal_project_tasks.collaborator_ids)
  or internal_project_tasks.created_by = auth.uid()
);

-- Un stagiaire ne crée ni ne supprime des tâches de son propre chef — seule
-- l'attribution par un responsable a du sens ici (comme demandé : "un
-- responsable doit pouvoir attribuer une tâche").
drop policy if exists "internal_project_tasks: insert by agency member" on public.internal_project_tasks;
create policy "internal_project_tasks: insert by agency member"
on public.internal_project_tasks for insert
to authenticated
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or (
    not public.has_role(auth.uid(), 'intern'::app_role)
    and exists (
      select 1 from public.agency_members m
      where m.agency_id = internal_project_tasks.agency_id
        and m.user_id = auth.uid()
    )
  )
);

drop policy if exists "internal_project_tasks: delete by agency member" on public.internal_project_tasks;
create policy "internal_project_tasks: delete by agency member"
on public.internal_project_tasks for delete
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or (
    not public.has_role(auth.uid(), 'intern'::app_role)
    and exists (
      select 1 from public.agency_members m
      where m.agency_id = internal_project_tasks.agency_id
        and m.user_id = auth.uid()
    )
  )
);
