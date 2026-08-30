-- Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : "Automatisations
-- du pipeline configurées séparément par société... quand un client change
-- d'étape avec automatisation, propose 'Oui, préparer l'email' / 'Non'".
-- Table dédiée — distincte de la table `automations` déjà existante, qui
-- gère un tout autre réglage (rappels quotidiens personnels par
-- utilisateur, sans rapport avec le pipeline). Les étapes de pipeline sont
-- stockées en texte libre (Pipeline.tsx : `stages: string[]` sur l'objet
-- pipeline, pas de table pipeline_stages normalisée) — on matche donc sur
-- le NOM de l'étape, pas un id.
create table if not exists public.pipeline_automations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  stage_name text not null,
  email_subject text not null default '',
  email_body text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_automations_agency_stage_idx on public.pipeline_automations(agency_id, stage_name);

alter table public.pipeline_automations enable row level security;

-- Même politique que les autres tables de configuration d'agence : tout
-- membre de l'agence peut voir/gérer (outil d'équipe partagé), cf. le
-- pattern déjà utilisé pour kanban_boards (migration 20260826207000).
create policy "pipeline_automations: agency members all"
on public.pipeline_automations for all
to authenticated
using (exists (select 1 from public.agency_members am where am.agency_id = pipeline_automations.agency_id and am.user_id = auth.uid()))
with check (exists (select 1 from public.agency_members am where am.agency_id = pipeline_automations.agency_id and am.user_id = auth.uid()));

alter publication supabase_realtime add table public.pipeline_automations;
