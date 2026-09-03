-- ─────────────────────────────────────────────────────────────────────────
-- Liens de visite temporaires ImmoSphera360 (3 septembre 2026).
--
-- Signalé : le client qui reçoit le lien doit se connecter avec Gmail.
-- Le lien ouvrait l'application, donc l'écran de connexion de l'équipe.
-- Désormais /immosphera/visite/<jeton> est une page publique : elle
-- résout le jeton via la fonction ci-dessous, sans compte, puis affiche
-- « Le lien n'est plus valable » une fois le délai passé.
--
-- À appliquer dans Supabase → SQL Editor. Rejouable sans risque.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

create table if not exists public.immosphera_tour_tokens (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.immosphera_properties (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  tour_type text not null default 'giraffe360',
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_immosphera_tour_tokens_token on public.immosphera_tour_tokens (token);

alter table public.immosphera_tour_tokens enable row level security;

-- L'équipe ImmoSphera (et le super admin) crée et consulte ses liens.
drop policy if exists "immosphera_tour_tokens: équipe" on public.immosphera_tour_tokens;
create policy "immosphera_tour_tokens: équipe" on public.immosphera_tour_tokens
for all to authenticated
using (public.can_access_immosphera())
with check (public.can_access_immosphera());

-- Résolution publique d'un jeton. Ne renvoie que ce qu'il faut pour
-- afficher la visite : jamais la fiche complète du bien.
--   statut = 'ok'       → tour_url, expires_at, titre, adresse
--   statut = 'expire'   → expires_at (message « Le lien n'est plus valable »)
--   statut = 'invalide' → jeton inconnu
create or replace function public.get_immosphera_tour_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _t record;
  _p record;
  _url text;
begin
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('statut', 'invalide');
  end if;

  select * into _t from public.immosphera_tour_tokens where token = p_token;
  if not found then
    return jsonb_build_object('statut', 'invalide');
  end if;

  if _t.expires_at <= now() then
    return jsonb_build_object('statut', 'expire', 'expires_at', _t.expires_at);
  end if;

  select title, address, virtual_tour_url, giraffe_url
    into _p
    from public.immosphera_properties
   where id = _t.property_id;
  if not found then
    return jsonb_build_object('statut', 'invalide');
  end if;

  if _t.tour_type = 'giraffe360_site' then
    _url := coalesce(_p.giraffe_url, _p.virtual_tour_url);
  else
    _url := coalesce(_p.virtual_tour_url, _p.giraffe_url);
  end if;

  return jsonb_build_object(
    'statut', 'ok',
    'tour_url', _url,
    'expires_at', _t.expires_at,
    'titre', _p.title,
    'adresse', _p.address
  );
end;
$$;

revoke all on function public.get_immosphera_tour_by_token(text) from public;
grant execute on function public.get_immosphera_tour_by_token(text) to anon, authenticated;
