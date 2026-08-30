-- Signalé (découvert en testant le ticket 16/16) : la policy
-- "members_read_active_announcements" n'autorisait la lecture QUE si une
-- ligne existait dans announcement_agencies pour l'agence de
-- l'utilisateur — une annonce "toutes les agences" (aucune ligne dans
-- announcement_agencies, cas normal et voulu) était donc invisible pour
-- TOUT utilisateur non super_admin, malgré le code client qui suppose
-- l'inverse ("pas de restriction = visible par tous"). Corrigée pour
-- couvrir les 3 cas réels : aucune restriction (visible par tous), agence
-- de l'utilisateur restreinte, ou ciblage sur cette personne précise
-- (target_user_id, ticket 16/16).
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
        not exists (select 1 from public.announcement_agencies aa where aa.announcement_id = announcements.id)
        or exists (
          select 1 from public.announcement_agencies aa
          join public.agency_members am on am.agency_id = aa.agency_id
          where aa.announcement_id = announcements.id and am.user_id = auth.uid()
        )
      )
    )
  )
);
