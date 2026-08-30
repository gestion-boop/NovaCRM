-- Demande explicite : "dans les annonces, mets la possibilité de créer un
-- sondage avec possibilité de rajouter des choix (oui/non/peut-être/
-- intéressé/pas intéressé/présent/absent...)" — étend le système
-- d'annonces existant plutôt que de créer un mécanisme séparé : une
-- annonce PEUT porter un sondage (options + votes), auquel cas voter tient
-- lieu de "lecture" (le bouton de fermeture devient le vote lui-même).
alter table public.announcements add column if not exists is_poll boolean not null default false;

create table if not exists public.announcement_poll_options (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.announcement_poll_votes (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  option_id uuid not null references public.announcement_poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

alter table public.announcement_poll_options enable row level security;
alter table public.announcement_poll_votes enable row level security;

-- Les libellés d'options ne sont pas sensibles (comparable au message de
-- l'annonce elle-même, déjà lisible par tous) — lecture ouverte à tout
-- utilisateur connecté, simple et sans jointure (évite la classe de bug
-- déjà rencontrée avec des policies imbriquées entre plusieurs tables).
create policy "authenticated read poll options"
on public.announcement_poll_options for select
to authenticated
using (true);

create policy "super_admin manage poll options"
on public.announcement_poll_options for all
to authenticated
using (public.has_role(auth.uid(), 'super_admin'::app_role))
with check (public.has_role(auth.uid(), 'super_admin'::app_role));

-- Un vote n'est visible que par son auteur, ou par un super admin (pour les
-- résultats agrégés côté Paramètres/Annonces).
create policy "read own vote or super_admin"
on public.announcement_poll_votes for select
to authenticated
using (user_id = auth.uid() or public.has_role(auth.uid(), 'super_admin'::app_role));

create policy "insert own vote"
on public.announcement_poll_votes for insert
to authenticated
with check (user_id = auth.uid());

-- Changer son vote (une seule ligne par utilisateur/annonce, contrainte
-- unique ci-dessus) plutôt que d'en accumuler plusieurs.
create policy "update own vote"
on public.announcement_poll_votes for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

alter publication supabase_realtime add table public.announcement_poll_votes;
