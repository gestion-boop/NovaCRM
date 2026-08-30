-- Signalé (découvert en testant le ticket 16/16), cause réelle trouvée après
-- investigation : `announcement_agencies` a déjà une policy de lecture
-- ("members_read_announcement_agencies") qui limite la visibilité d'une
-- ligne de restriction aux membres de CETTE agence précise. Résultat : le
-- `NOT EXISTS (select 1 from announcement_agencies where announcement_id =
-- ...)` de la policy sur `announcements` (migration 20260826213000) ne
-- voyait JAMAIS la ligne de restriction d'une AUTRE agence (invisible via
-- RLS pour l'utilisateur courant), et concluait donc à tort "aucune
-- restriction" — fuite confirmée en test réel (un commercial de Conseils
-- Finances voyait une annonce réservée à Novavisio).
--
-- Fix : une fonction SECURITY DEFINER, qui contourne délibérément le RLS de
-- `announcement_agencies` UNIQUEMENT pour répondre à la question binaire
-- "cette annonce a-t-elle une restriction, oui/non" (aucune donnée exposée,
-- juste un booléen) — la policy sur `announcements` s'appuie dessus au lieu
-- du NOT EXISTS direct.
create or replace function public.announcement_has_agency_restriction(p_announcement_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.announcement_agencies where announcement_id = p_announcement_id);
$$;

grant execute on function public.announcement_has_agency_restriction(uuid) to authenticated;

drop policy if exists "members_read_active_announcements" on public.announcements;

create policy "members_read_active_announcements"
on public.announcements for select
to public
using (
  is_active = true
  and (
    target_user_id = auth.uid()
    or (
      target_user_id is null
      and (
        not public.announcement_has_agency_restriction(id)
        or exists (
          select 1 from public.announcement_agencies aa
          join public.agency_members am on am.agency_id = aa.agency_id
          where aa.announcement_id = announcements.id and am.user_id = auth.uid()
        )
      )
    )
  )
);
