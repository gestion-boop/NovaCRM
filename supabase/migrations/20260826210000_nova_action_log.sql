-- Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16) : "Capacités
-- d'action étendues de Nova... journal des actions (qui, quoi, quand,
-- résultat)". Journal minimal, écrit côté client juste après l'exécution
-- réelle d'une action Nova sensible (jamais avant, pour refléter le
-- résultat effectif, pas seulement l'intention du modèle).
create table if not exists public.nova_action_log (
  id uuid primary key default gen_random_uuid(),
  agent_user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  args jsonb not null default '{}'::jsonb,
  ok boolean not null,
  result_message text,
  created_at timestamptz not null default now()
);

create index if not exists nova_action_log_agent_user_id_idx on public.nova_action_log(agent_user_id);
create index if not exists nova_action_log_created_at_idx on public.nova_action_log(created_at desc);

alter table public.nova_action_log enable row level security;

-- Seul l'auteur de l'action peut écrire sa propre ligne (jamais au nom de
-- quelqu'un d'autre) — en pratique, seul le compte "nova_super_assistant"
-- (Sylvain) déclenche ces outils, cf. api/ai/agent.ts.
create policy "nova_action_log: insert own"
on public.nova_action_log for insert
to authenticated
with check (agent_user_id = auth.uid());

-- Lecture réservée aux super admins (journal d'audit).
create policy "nova_action_log: select super_admin"
on public.nova_action_log for select
to authenticated
using (public.has_role(auth.uid(), 'super_admin'::app_role));

alter publication supabase_realtime add table public.nova_action_log;
