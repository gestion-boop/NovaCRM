-- ─────────────────────────────────────────────────────────────────────────
-- Académy — image de fond des dossiers, demandée le 2 septembre.
--
-- « Je voudrais pouvoir mettre une image de fond dans les dossiers. »
--
-- Un dossier n'existait jusqu'ici que par le texte `rubrique` porté par
-- chaque procédure : il n'y avait nulle part où poser une image. Cette table
-- lui donne une existence propre — sans casser l'existant, puisque le lien se
-- fait toujours par le NOM : une rubrique sans ligne ici reste un dossier
-- valide, simplement sans visuel.
--
-- Renommer un dossier reviendra donc à renommer la rubrique de ses procédures
-- ET la ligne ici ; c'est le prix d'un lien par le nom, et il est faible
-- devant celui d'une migration de toutes les fiches existantes.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.academy_folders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  nom text not null,
  image_url text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, nom)
);

alter table public.academy_folders enable row level security;

drop policy if exists "academy_folders: lecture par les membres de l'agence" on public.academy_folders;
create policy "academy_folders: lecture par les membres de l'agence" on public.academy_folders
for select to authenticated
using (
  exists (
    select 1 from public.agency_members m
    where m.user_id = auth.uid() and m.agency_id = academy_folders.agency_id
  )
  or has_role(auth.uid(), 'super_admin'::app_role)
);

drop policy if exists "academy_folders: écriture réservée aux super admins" on public.academy_folders;
create policy "academy_folders: écriture réservée aux super admins" on public.academy_folders
for all to authenticated
using (has_role(auth.uid(), 'super_admin'::app_role))
with check (has_role(auth.uid(), 'super_admin'::app_role));
