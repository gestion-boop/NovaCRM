-- Ticket "Paramètres/Nova/Utilisateurs/Annonces" (16/16) : système d'annonces
-- à 3 niveaux (info/important/urgent), ciblage (personne/agence/toutes
-- agences — le ciblage par agence existe déjà via announcement_agencies),
-- lien direct vers un élément du CRM, lecture obligatoire pour le rouge,
-- historique de lecture (déjà en place via announcement_reads), expiration
-- automatique.
alter table public.announcements
  add column if not exists level text not null default 'info' check (level in ('info', 'important', 'urgent')),
  add column if not exists link text,
  add column if not exists expires_at timestamptz,
  add column if not exists target_user_id uuid references auth.users(id) on delete cascade;

create index if not exists announcements_target_user_id_idx on public.announcements(target_user_id);
