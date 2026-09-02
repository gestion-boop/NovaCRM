-- ─────────────────────────────────────────────────────────────────────────
-- Académy — demandé le 2 septembre pour ImmoSphera.
--
-- « Je voudrais une tuile Académy ImmoSphera, on regroupera dedans toutes les
--   procédures en PDF et voir vidéos. Comment pouvons-nous faire pour mettre
--   en place une fenêtre avec tout ça bien organisée pour que les agents co se
--   repèrent très facilement ? »
--
-- Une table dédiée plutôt que la table `documents` : un document client et une
-- procédure d'agence n'ont ni les mêmes droits, ni le même cycle de vie, ni la
-- même façon d'être rangés. Les mélanger aurait fait apparaître les procédures
-- dans le Coffre Documents de chaque client.
--
-- Le FICHIER, lui, reste dans le Google Drive de l'agence, exactement comme le
-- Coffre Documents : la table ne garde que son lien. Rien n'est hébergé par le
-- CRM, et les fichiers restent la propriété de l'agence.
--
-- Rangement : une `rubrique` (texte libre) suffit à regrouper. Une table de
-- catégories aurait figé la liste et obligé à passer par un écran
-- d'administration pour créer une rubrique — pour un contenu qui tient en
-- quelques dizaines de fiches, c'est du poids sans bénéfice.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.academy_resources (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  rubrique text not null default 'Général',
  titre text not null,
  description text,
  -- 'pdf' ou 'video' : décide de l'icône, de la couleur et de la façon
  -- d'ouvrir la ressource.
  type text not null default 'pdf',
  -- Fichier déposé dans le Drive de l'agence.
  drive_file_id text,
  drive_web_view_link text,
  -- Ou simple lien (une vidéo YouTube/Vimeo déjà en ligne, par exemple).
  external_url text,
  -- « 8 min », « 4 pages »... affiché tel quel, jamais calculé.
  duree text,
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academy_resources_agency_idx
  on public.academy_resources (agency_id, rubrique, position);

alter table public.academy_resources enable row level security;

-- Lecture : tous les membres de l'agence. C'est le but même de l'Académy.
drop policy if exists "academy: lecture par les membres de l'agence" on public.academy_resources;
create policy "academy: lecture par les membres de l'agence" on public.academy_resources
for select to authenticated
using (
  exists (
    select 1 from public.agency_members m
    where m.user_id = auth.uid() and m.agency_id = academy_resources.agency_id
  )
  or has_role(auth.uid(), 'super_admin'::app_role)
);

-- Écriture : super admins uniquement — « c'est ce qui garantit qu'une
-- procédure affichée fait autorité ».
drop policy if exists "academy: écriture réservée aux super admins" on public.academy_resources;
create policy "academy: écriture réservée aux super admins" on public.academy_resources
for all to authenticated
using (has_role(auth.uid(), 'super_admin'::app_role))
with check (has_role(auth.uid(), 'super_admin'::app_role));
