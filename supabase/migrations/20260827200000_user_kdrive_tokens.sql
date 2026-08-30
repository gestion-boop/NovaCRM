-- Ticket #267 : "serais-tu capable de chercher des documents ou autres dans
-- kDrive aussi ?" — table dédiée au jeton OAuth Infomaniak kDrive de chaque
-- utilisateur (distinct de Google Workspace), pour permettre à Nova IA de
-- rechercher des documents dans le kDrive du compte connecté.
create table if not exists public.user_kdrive_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  drive_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_kdrive_tokens enable row level security;

-- Jamais d'accès direct depuis le client (le jeton est un secret) — toute
-- lecture/écriture passe exclusivement par les fonctions serverless via la
-- clé service_role, qui contourne RLS. Aucune policy "authenticated" créée
-- volontairement.
