-- ─────────────────────────────────────────────────────────────────────────
-- Corbeille et journal des fiches clients (3 septembre 2026).
--
-- Signalé : deux contacts saisis la veille par Natacha ont disparu de la
-- liste. Depuis le 2 septembre, « supprimer un dossier » dans le pipeline
-- efface la fiche pour de bon, pour tous les membres de l'agence — sans
-- trace, sans retour possible.
--
-- Ce que cette migration apporte :
--   1. Une CORBEILLE : `leads.deleted_at` / `leads.deleted_by`. Supprimer
--      une fiche la met de côté au lieu de l'effacer ; Paramètres →
--      « Corbeille des clients » la restaure en un clic.
--   2. Un JOURNAL : `leads_journal` reçoit, par déclencheur, une ligne à
--      chaque création, modification, mise à la corbeille, restauration ou
--      suppression définitive d'une fiche, avec QUI, QUAND, et la fiche
--      complète AVANT et APRÈS. C'est une sauvegarde fiche par fiche :
--      une fiche effacée se recrée depuis sa dernière version, sans
--      restaurer toute la base.
--
-- À appliquer dans Supabase → SQL Editor. Le CRM fonctionne sans elle
-- (les listes ignorent simplement la corbeille), mais « Supprimer »
-- affichera une erreur tant qu'elle n'est pas passée.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists idx_leads_deleted_at
  on public.leads (deleted_at)
  where deleted_at is not null;

create table if not exists public.leads_journal (
  id bigserial primary key,
  lead_id uuid not null,
  agency_id text,
  action text not null check (action in ('creation', 'modification', 'corbeille', 'restauration', 'suppression')),
  user_id uuid,
  user_email text,
  at timestamptz not null default now(),
  avant jsonb,
  apres jsonb
);

create index if not exists idx_leads_journal_lead on public.leads_journal (lead_id, at desc);
create index if not exists idx_leads_journal_agence on public.leads_journal (agency_id, at desc);

alter table public.leads_journal enable row level security;

-- Lecture : le super admin voit tout ; un membre voit le journal des fiches
-- de son agence. Aucune écriture directe : seul le déclencheur ci-dessous
-- (security definer) alimente la table.
drop policy if exists "leads_journal: lecture par l'agence" on public.leads_journal;
create policy "leads_journal: lecture par l'agence" on public.leads_journal
for select to authenticated
using (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  or exists (
    select 1 from public.agency_members m
    where m.user_id = auth.uid() and m.agency_id::text = leads_journal.agency_id
  )
);

create or replace function public.journaliser_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _email text := nullif(coalesce(auth.jwt() ->> 'email', ''), '');
  _action text;
begin
  if tg_op = 'INSERT' then
    insert into public.leads_journal (lead_id, agency_id, action, user_id, user_email, avant, apres)
    values (new.id, new.agency_id::text, 'creation', _uid, _email, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      _action := 'corbeille';
    elsif old.deleted_at is not null and new.deleted_at is null then
      _action := 'restauration';
    else
      _action := 'modification';
    end if;
    insert into public.leads_journal (lead_id, agency_id, action, user_id, user_email, avant, apres)
    values (new.id, new.agency_id::text, _action, _uid, _email, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.leads_journal (lead_id, agency_id, action, user_id, user_email, avant, apres)
    values (old.id, old.agency_id::text, 'suppression', _uid, _email, to_jsonb(old), null);
    return old;
  end if;
end;
$$;

drop trigger if exists trg_journaliser_lead on public.leads;
create trigger trg_journaliser_lead
after insert or update or delete on public.leads
for each row execute function public.journaliser_lead();
