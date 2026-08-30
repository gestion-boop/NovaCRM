-- Ticket "Clients invités" (12/13) : demandes de documents par le
-- conseiller. Nouvelle table (contrairement au chat, aucune table
-- réutilisable existante ne convient) avec ses policies écrites directement
-- avec le bon périmètre dès la création — pas besoin du mécanisme de
-- verrou générique (20260826180000_client_guest_lockdown.sql), réservé aux
-- tables PRÉ-EXISTANTES qui n'avaient aucun scoping par agence.
--
-- Statuts (ticket) : demandé → consulté → reçu → validé / refusé.
-- Stockés sans accents pour éviter tout souci d'encodage côté check
-- constraint ; affichés avec accents côté UI.

create table if not exists public.document_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agency_id uuid not null references public.agencies(id),
  requested_by uuid references public.profiles(id) on delete set null,
  doc_type text not null,
  deadline date,
  message text,
  status text not null default 'demande' check (status in ('demande', 'consulte', 'recu', 'valide', 'refuse')),
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_requests_lead_id on public.document_requests (lead_id);
create index if not exists idx_document_requests_agency_id on public.document_requests (agency_id);

alter table public.document_requests enable row level security;

-- Équipe (agence de la fiche) : lit/crée/modifie les demandes de sa fiche.
drop policy if exists "document_requests: staff select by lead agency" on public.document_requests;
create policy "document_requests: staff select by lead agency" on public.document_requests
for select to authenticated
using (
  exists (
    select 1 from public.leads l
    join public.agency_members m on m.agency_id = l.agency_id
    where l.id = document_requests.lead_id and m.user_id = auth.uid()
  )
);

drop policy if exists "document_requests: staff insert by lead agency" on public.document_requests;
create policy "document_requests: staff insert by lead agency" on public.document_requests
for insert to authenticated
with check (
  requested_by = auth.uid()
  and exists (
    select 1 from public.leads l
    join public.agency_members m on m.agency_id = l.agency_id
    where l.id = document_requests.lead_id and m.user_id = auth.uid()
  )
);

drop policy if exists "document_requests: staff update by lead agency" on public.document_requests;
create policy "document_requests: staff update by lead agency" on public.document_requests
for update to authenticated
using (
  exists (
    select 1 from public.leads l
    join public.agency_members m on m.agency_id = l.agency_id
    where l.id = document_requests.lead_id and m.user_id = auth.uid()
  )
);

-- Client invité : lit les demandes de SA fiche, et peut seulement les
-- marquer "consultée" lui-même (le passage à "reçu" est fait par le
-- service_role au moment de l'upload — cf. upload-client-document — jamais
-- directement par le client, pour ne pas pouvoir se déclarer "reçu" sans
-- avoir réellement envoyé de document).
drop policy if exists "document_requests: client_guest select own lead" on public.document_requests;
create policy "document_requests: client_guest select own lead" on public.document_requests
for select to authenticated
using (
  exists (
    select 1 from public.client_guest_access ga
    where ga.lead_id = document_requests.lead_id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
);

drop policy if exists "document_requests: client_guest mark consulted" on public.document_requests;
create policy "document_requests: client_guest mark consulted" on public.document_requests
for update to authenticated
using (
  status = 'demande'
  and exists (
    select 1 from public.client_guest_access ga
    where ga.lead_id = document_requests.lead_id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
)
with check (
  status = 'consulte'
  and exists (
    select 1 from public.client_guest_access ga
    where ga.lead_id = document_requests.lead_id and ga.user_id = auth.uid() and ga.status in ('active', 'envoyee')
  )
);

alter publication supabase_realtime add table public.document_requests;
