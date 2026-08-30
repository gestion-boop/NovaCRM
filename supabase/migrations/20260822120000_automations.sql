-- Ticket #25 (nouvelle base) : automatisations Nova IA (récap de journée,
-- récap mails à horaires fixes). Deux tables : la config des automatisations
-- par utilisateur, et un cache du jeton d'accès Google le temps qu'il reste
-- valide, alimenté côté client, pour permettre au job planifié de lire les
-- mails même quand l'utilisateur n'a pas l'app ouverte à cet instant précis
-- (tant que le jeton mis en cache n'a pas expiré, ~1h).

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('daily_brief', 'mail_digest')),
  times text[] not null default '{}', -- ex: {'09:00'} ou {'08:00','12:00','15:00','18:00'}
  is_active boolean not null default true,
  last_fired_slot text, -- ex: '2026-08-22T09:00' — évite un double envoi dans le même créneau
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automations enable row level security;

create policy "Users manage their own automations"
  on public.automations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists automations_active_idx on public.automations (is_active) where is_active;

create table if not exists public.user_google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.user_google_tokens enable row level security;

create policy "Users manage their own cached Google token"
  on public.user_google_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
