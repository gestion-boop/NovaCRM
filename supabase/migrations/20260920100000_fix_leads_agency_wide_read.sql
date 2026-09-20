-- Signalé le 20 septembre : « les utilisateurs qui créent des pipelines ont
-- souvent des contacts d'autres personnes qui apparaissent dans la première
-- colonne ». Cause : la policy "leads: lecture par les membres de l'agence"
-- ouvrait la lecture à TOUS les membres d'une agence dès que cette agence
-- n'était PAS Immosphera (clause `agency_id <> '15157...' `), ce qui
-- rendait Novavisio et Conseils Finances totalement décloisonnés — l'effet
-- recherché (Pipeline Transactions V2 ouvert à tous) devait s'appliquer à
-- CE pipeline précis, pas à "toute agence différente d'Immosphera".
--
-- On restreint donc la policy à : ce pipeline précis, ou un admin/super_admin
-- — jamais plus. La policy restrictive "Owner assignee guest views leads"
-- (created_by / assigned_to / super_admin / invité) reste inchangée et
-- continue de s'appliquer normalement (policies RLS combinées en OR).
drop policy if exists "leads: lecture par les membres de l'agence" on public.leads;

create policy "leads: lecture par les membres de l'agence"
on public.leads
for select
using (
  agency_id is not null
  and is_agency_member(auth.uid(), agency_id)
  and (
    pipeline_id = '8f79d05c-d191-43bb-8323-bedbd722f9f2'::uuid
    or has_role(auth.uid(), 'admin'::app_role)
  )
);
