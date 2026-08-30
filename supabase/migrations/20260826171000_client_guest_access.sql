-- Ticket "Clients invités" (2/13) : table de liaison entre une fiche client
-- existante (leads.id) et son futur compte invité — reliés par
-- l'identifiant unique de la fiche, PAS uniquement par l'adresse e-mail
-- (demande explicite). Un statut d'accès explicite, distinct du compte
-- Supabase Auth lui-même (qui peut ne pas encore exister au moment où
-- l'invitation est "à envoyer").

create table if not exists public.client_guest_access (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agency_id uuid not null references public.agencies(id),
  -- Rempli une fois le compte Supabase Auth réellement créé (après premher
  -- envoi réussi) — nullable tant que l'invitation n'a pas encore de compte.
  user_id uuid references public.profiles(id) on delete set null,
  email text not null,
  status text not null default 'a_envoyer' check (
    status in ('a_envoyer', 'envoyee', 'expiree', 'active', 'suspendue', 'revoquee')
  ),
  invited_by uuid references public.profiles(id),
  invited_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Une seule invitation active par fiche client.
  unique (lead_id)
);

create index if not exists idx_client_guest_access_agency on public.client_guest_access (agency_id);
create index if not exists idx_client_guest_access_user on public.client_guest_access (user_id);

alter table public.client_guest_access enable row level security;

-- Lecture/écriture : membres de l'agence de la fiche (même principe que le
-- reste de l'appli), super_admin partout. Le client lui-même (role
-- client_guest) n'a PAS accès à cette table de gestion — uniquement à sa
-- propre fiche via des policies dédiées ajoutées dans les tickets suivants.
create policy "client_guest_access: select by agency member"
on public.client_guest_access for select
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = client_guest_access.agency_id
      and m.user_id = auth.uid()
  )
);

create policy "client_guest_access: insert by agency member"
on public.client_guest_access for insert
to authenticated
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = client_guest_access.agency_id
      and m.user_id = auth.uid()
  )
);

create policy "client_guest_access: update by agency member"
on public.client_guest_access for update
to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = client_guest_access.agency_id
      and m.user_id = auth.uid()
  )
)
with check (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.agency_id = client_guest_access.agency_id
      and m.user_id = auth.uid()
  )
);

create policy "client_guest_access: delete by super_admin"
on public.client_guest_access for delete
to authenticated
using (public.has_role(auth.uid(), 'super_admin'::app_role));

alter publication supabase_realtime add table public.client_guest_access;
