-- ─────────────────────────────────────────────────────────────────────────
-- Académy — validation de lecture, demandée le 2 septembre.
--
-- « Seuls les super admins pourront ajouter ou supprimer ; les utilisateurs,
--   une fois vu, pourront par exemple cocher valider la procédure comme quoi
--   ils l'ont vue. »
--
-- Une ligne = une personne a validé une procédure. Pas de colonne « lu » sur
-- la ressource elle-même : l'information est propre à chaque utilisateur, la
-- poser sur la ressource aurait mélangé tout le monde.
--
-- La clé primaire porte sur le couple (ressource, utilisateur) : valider deux
-- fois ne crée pas deux lignes, et « dévalider » se fait en supprimant.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.academy_reads (
  resource_id uuid not null references public.academy_resources (id) on delete cascade,
  user_id uuid not null,
  validated_at timestamptz not null default now(),
  primary key (resource_id, user_id)
);

create index if not exists academy_reads_user_idx on public.academy_reads (user_id);

alter table public.academy_reads enable row level security;

-- Chacun voit et gère SES validations. Les super admins voient celles de tout
-- le monde : c'est ce qui permet de savoir qui a pris connaissance de quoi,
-- notamment à l'arrivée d'un nouvel agent.
drop policy if exists "academy_reads: chacun les siennes" on public.academy_reads;
create policy "academy_reads: chacun les siennes" on public.academy_reads
for select to authenticated
using (user_id = auth.uid() or has_role(auth.uid(), 'super_admin'::app_role));

drop policy if exists "academy_reads: valider pour soi" on public.academy_reads;
create policy "academy_reads: valider pour soi" on public.academy_reads
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "academy_reads: annuler sa validation" on public.academy_reads;
create policy "academy_reads: annuler sa validation" on public.academy_reads
for delete to authenticated
using (user_id = auth.uid());
