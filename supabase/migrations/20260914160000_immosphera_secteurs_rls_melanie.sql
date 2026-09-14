-- Demande explicite (14 septembre) : « on est d'accord que c'est uniquement
-- Mélanie et Sylvain qui pourront mettre les secteurs ? Et personne
-- d'autres. » Les policies d'écriture étaient limitées aux super admins
-- (Sylvain) — Mélanie, gérante d'agence mais pas super admin (même
-- principe que estDirectionCF dans Sidebar.tsx), en était exclue alors
-- qu'elle doit pouvoir les gérer.
drop policy if exists "super admins write secteurs" on public.immosphera_secteurs;
drop policy if exists "super admins update secteurs" on public.immosphera_secteurs;
drop policy if exists "super admins delete secteurs" on public.immosphera_secteurs;

create policy "melanie et super admins write secteurs"
  on public.immosphera_secteurs for insert
  with check (has_role(auth.uid(), 'super_admin') or lower(auth.email()) = 'melanie@immosphera.fr');

create policy "melanie et super admins update secteurs"
  on public.immosphera_secteurs for update
  using (has_role(auth.uid(), 'super_admin') or lower(auth.email()) = 'melanie@immosphera.fr')
  with check (has_role(auth.uid(), 'super_admin') or lower(auth.email()) = 'melanie@immosphera.fr');

create policy "melanie et super admins delete secteurs"
  on public.immosphera_secteurs for delete
  using (has_role(auth.uid(), 'super_admin') or lower(auth.email()) = 'melanie@immosphera.fr');
