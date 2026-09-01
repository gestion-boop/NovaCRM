-- ─────────────────────────────────────────────────────────────────────────
-- 1. Deux champs demandés sur les fiches clients, absents de `leads`.
--
--    `mandate_number` : le numéro de mandat, affiché dans les fenêtres de
--    détail des statistiques à côté de la ville (la ville existe déjà, c'est
--    la colonne `sector`).
--
--    `advisor_commission_ttc` : la commission du conseiller immobilier,
--    saisie TTC. Le montant HT est calculé à l'affichage plutôt que stocké,
--    pour qu'un changement de taux ne fausse pas l'historique.
--
--    Le chiffre d'affaires de l'agence reste dans `estimated_value` — le
--    champ renommé « Commission agence » dans l'interface. Les montants déjà
--    saisis sont des montants HT et ne sont pas convertis.
--
--    Aucune valeur par défaut : les fiches existantes restent à NULL, ce qui
--    se distingue d'un zéro réellement saisi.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists mandate_number text,
  add column if not exists advisor_commission_ttc numeric;

comment on column public.leads.mandate_number is
  'Numéro de mandat, affiché dans le détail des statistiques.';
comment on column public.leads.advisor_commission_ttc is
  'Commission du conseiller immobilier, saisie TTC. Le HT est calculé à l''affichage.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Filet de sécurité sur les positions du pipeline.
--
--    Incident du 30/08/2026 : ajouter une colonne à un pipeline a détaché 21
--    dossiers de leurs étapes, sans aucun moyen de revenir en arrière. La
--    cause est corrigée, mais la position des dossiers n'était sauvegardée
--    nulle part — impossible de restaurer.
--
--    Avant toute modification d'étapes, l'appli enregistre ici la position de
--    chaque dossier du pipeline. Un bouton « Restaurer les positions » les
--    remet en place.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.pipeline_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  agency_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reason text,
  -- [{ "lead_id": "…", "stage_id": "…" }, …]
  positions jsonb not null
);

create index if not exists pipeline_position_snapshots_pipeline_idx
  on public.pipeline_position_snapshots (pipeline_id, created_at desc);

alter table public.pipeline_position_snapshots enable row level security;

-- Même portée que les pipelines eux-mêmes : les membres de l'agence.
drop policy if exists "snapshots: membres de l'agence" on public.pipeline_position_snapshots;
create policy "snapshots: membres de l'agence" on public.pipeline_position_snapshots
for all to authenticated
using (
  exists (
    select 1 from public.agency_members m
    where m.user_id = auth.uid() and m.agency_id = pipeline_position_snapshots.agency_id
  )
)
with check (
  exists (
    select 1 from public.agency_members m
    where m.user_id = auth.uid() and m.agency_id = pipeline_position_snapshots.agency_id
  )
);


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Équipe par défaut d'un projet interne.
--
--    Demandé : les tâches créées dans le projet de Sarah doivent être
--    affiliées d'office à Sarah et Mélanie. Plutôt que d'inscrire deux noms
--    dans le code — ce qui a rendu l'attribution des contacts inutilisable —
--    chaque projet porte sa propre équipe par défaut, réglable depuis son
--    en-tête.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.task_boards
  add column if not exists default_collaborator_ids uuid[] not null default '{}';

comment on column public.task_boards.default_collaborator_ids is
  'Collaborateurs assignés d''office à chaque nouvelle tâche du projet.';
