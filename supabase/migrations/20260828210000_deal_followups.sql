-- Demande explicite (28/08/2026) : "quand on déplace un dossier dans une
-- colonne, on puisse mettre un message de relance programmé — 3 jours, 5
-- jours, 10 jours, 15 jours — et Nova nous dise 'où en es-tu sur ce
-- dossier ?' quand ça fait un moment qu'il n'y a pas eu de mouvement."
--
-- Une ligne = une relance programmée sur un dossier (lead). Vérifiée
-- périodiquement par le même cron que le résumé quotidien
-- (api/ai/agent.ts, handleDealFollowupsCron) : à échéance, crée une
-- notification "Nova" pour l'utilisateur qui l'a programmée. Annulée
-- automatiquement dès que le dossier change réellement d'étape avant
-- l'échéance (voir Pipeline.tsx) — pas de relance si le dossier a bougé,
-- l'intelligence attendue.
create table if not exists public.deal_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agency_id uuid not null references public.agencies(id),
  created_by uuid references public.profiles(id),
  -- Étape du dossier au moment où la relance a été programmée — sert à
  -- détecter un changement d'étape entretemps (annulation automatique).
  stage_id_at_creation uuid,
  due_at timestamptz not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'notified', 'cancelled')),
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists idx_deal_followups_lead on public.deal_followups (lead_id);
create index if not exists idx_deal_followups_due on public.deal_followups (due_at) where status = 'pending';

alter table public.deal_followups enable row level security;

drop policy if exists "deal_followups: select by agency member" on public.deal_followups;
create policy "deal_followups: select by agency member"
on public.deal_followups for select
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = deal_followups.agency_id and m.user_id = auth.uid()
  )
);

drop policy if exists "deal_followups: insert by agency member" on public.deal_followups;
create policy "deal_followups: insert by agency member"
on public.deal_followups for insert
to authenticated
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = deal_followups.agency_id and m.user_id = auth.uid()
  )
);

drop policy if exists "deal_followups: update by agency member" on public.deal_followups;
create policy "deal_followups: update by agency member"
on public.deal_followups for update
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = deal_followups.agency_id and m.user_id = auth.uid()
  )
)
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = deal_followups.agency_id and m.user_id = auth.uid()
  )
);
