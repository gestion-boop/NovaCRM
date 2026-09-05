-- ─────────────────────────────────────────────────────────────────────────
-- Demande du 5 septembre, tableau de bord et fiche client de Conseils
-- Finances.
--
-- 1. Quatre champs sur la fiche client (Conseils Finances) :
--
--    `honoraires_courtier` : la commission du courtier, calculée
--    automatiquement (80 % pour Eric Escourrou, 70 % pour Coralia Ortega,
--    Lucie Perree et Karine Brebion) à partir des Honoraires agence
--    (`estimated_value`) — modifiable si besoin, comme les autres montants
--    de la fiche.
--
--    `montant_credit` : montant du crédit du client, base du calcul de Com
--    banques.
--
--    `banque_choisie` : la banque retenue (Caisse d'Épargne, Banque
--    Populaire, Banque postale, Société Générale).
--
--    `com_banque` : la commission bancaire, calculée automatiquement à
--    partir du montant du crédit et du taux de la banque retenue —
--    modifiable (le taux de la Société Générale dépend par exemple de si
--    le client en est déjà client, et celui de la Banque postale n'est pas
--    encore connu).
--
--    Aucune valeur par défaut : les fiches existantes restent à NULL,
--    comme les autres montants ajoutés à `leads` (voir
--    20260831000000_leads_mandat_et_commission.sql).
--
-- 2. Objectif de l'année PAR COLLABORATEUR (Conseils Finances) : jusqu'ici
--    seul `annual_goals` existait (un objectif par AGENCE). Un collaborateur
--    a maintenant le sien, réglé individuellement par les super admins —
--    même modèle que `annual_goals`, une ligne par collaborateur/agence/année
--    (une même personne peut avoir deux agences, Karine par exemple). Un
--    collaborateur ne lit que le sien.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists honoraires_courtier numeric,
  add column if not exists montant_credit numeric,
  add column if not exists banque_choisie text,
  add column if not exists com_banque numeric;

comment on column public.leads.honoraires_courtier is
  'Honoraires courtier (Conseils Finances) : calculé automatiquement à partir des Honoraires agence (80 %/70 % selon le courtier), modifiable.';
comment on column public.leads.montant_credit is
  'Montant du crédit du client (Conseils Finances), base du calcul de Com banques.';
comment on column public.leads.banque_choisie is
  'Banque retenue pour le crédit (Conseils Finances) : Caisse d''Épargne, Banque Populaire, Banque postale ou Société Générale.';
comment on column public.leads.com_banque is
  'Commission bancaire (Conseils Finances), calculée automatiquement à partir du montant du crédit et de la banque retenue, modifiable.';

create table if not exists public.collaborator_annual_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  year integer not null,
  target_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, agency_id, year)
);

alter table public.collaborator_annual_goals enable row level security;

-- Chacun ne lit que SON objectif ; les super admins lisent ceux de tous.
drop policy if exists "collaborator_annual_goals: lecture de son propre objectif" on public.collaborator_annual_goals;
create policy "collaborator_annual_goals: lecture de son propre objectif" on public.collaborator_annual_goals
for select to authenticated
using (
  user_id = auth.uid()
  or has_role(auth.uid(), 'super_admin'::app_role)
);

drop policy if exists "collaborator_annual_goals: écriture réservée aux super admins" on public.collaborator_annual_goals;
create policy "collaborator_annual_goals: écriture réservée aux super admins" on public.collaborator_annual_goals
for all to authenticated
using (has_role(auth.uid(), 'super_admin'::app_role))
with check (has_role(auth.uid(), 'super_admin'::app_role));
