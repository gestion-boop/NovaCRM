-- Demande explicite (14 septembre) : « avoir une carte par secteur. Ils
-- veulent avoir des secteurs et s'envoyer des contacts si hors secteur si
-- besoin. »
--
-- `immosphera_secteurs` : une zone dessinée à la main sur la carte
-- (polygone, stocké comme une simple liste de points [lat,lng] — pas
-- besoin de PostGIS pour ce volume), avec un ou plusieurs conseillers
-- propriétaires. Seul un super admin peut créer/modifier/supprimer un
-- secteur (demande explicite) — tout membre Immosphera peut les consulter.
--
-- `conseiller_ids` référence les `id` statiques de src/immosphera/lib/
-- advisors.ts (ex. "pauline") plutôt qu'un user_id Supabase : les
-- conseillers ne sont pas (encore) une vraie table, cf. la liste codée en
-- dur déjà utilisée partout ailleurs dans le module (agent_name/agent_email
-- sur immosphera_properties).
create table if not exists public.immosphera_secteurs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  nom text not null,
  couleur text not null default '#E0A21A',
  polygone jsonb not null,
  conseiller_ids text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.immosphera_secteurs enable row level security;

create policy "immosphera members read secteurs"
  on public.immosphera_secteurs for select
  using (can_access_immosphera());

create policy "super admins write secteurs"
  on public.immosphera_secteurs for insert
  with check (has_role(auth.uid(), 'super_admin'));

create policy "super admins update secteurs"
  on public.immosphera_secteurs for update
  using (has_role(auth.uid(), 'super_admin'))
  with check (has_role(auth.uid(), 'super_admin'));

create policy "super admins delete secteurs"
  on public.immosphera_secteurs for delete
  using (has_role(auth.uid(), 'super_admin'));

-- `immosphera_contacts` : un prospect/contact rapide qu'un conseiller
-- enregistre. Géocodé côté client comme les Biens (src/immosphera/lib/
-- geo.ts) pour déterminer automatiquement son secteur (point-dans-polygone
-- calculé côté client, pas besoin de PostGIS non plus). Tout membre
-- Immosphera peut créer/lire/modifier un contact (pas réservé aux admins,
-- contrairement aux secteurs eux-mêmes) : c'est un usage courant au
-- quotidien, pas un réglage structurant.
create table if not exists public.immosphera_contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  nom text not null,
  telephone text,
  email text,
  adresse text not null,
  latitude double precision,
  longitude double precision,
  notes text,
  secteur_id uuid references public.immosphera_secteurs(id) on delete set null,
  conseiller_origine_id text,
  conseiller_assigne_id text,
  statut text not null default 'nouveau' check (statut in ('nouveau', 'transfere', 'traite')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.immosphera_contacts enable row level security;

create policy "immosphera members read contacts"
  on public.immosphera_contacts for select
  using (can_access_immosphera());

create policy "immosphera members insert contacts"
  on public.immosphera_contacts for insert
  with check (can_access_immosphera());

create policy "immosphera members update contacts"
  on public.immosphera_contacts for update
  using (can_access_immosphera())
  with check (can_access_immosphera());

create policy "immosphera members delete contacts"
  on public.immosphera_contacts for delete
  using (can_access_immosphera());

create index if not exists idx_immosphera_secteurs_agency on public.immosphera_secteurs (agency_id);
create index if not exists idx_immosphera_contacts_agency on public.immosphera_contacts (agency_id);
create index if not exists idx_immosphera_contacts_secteur on public.immosphera_contacts (secteur_id);
