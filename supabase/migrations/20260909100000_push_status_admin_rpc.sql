-- Signalé (9 septembre) : « Natacha ne reçoit pas ses notifications sur son
-- téléphone, peut-être mettre des trackers pour voir si cette option est
-- activée ». Vérification en base : elle a bien UNE souscription push,
-- mais depuis un navigateur de BUREAU (Windows/Chrome) — jamais depuis son
-- téléphone, qui n'a donc jamais activé l'option. Il n'existait aucun moyen
-- de le voir depuis l'appli (RLS sur push_subscriptions restreint chaque
-- ligne à son propriétaire, et aucune UI n'exposait ces données, même pour
-- un super admin) : il fallait interroger la base à la main.
--
-- Cette fonction (SECURITY DEFINER, réservée aux super admins de l'agence
-- concernée) renvoie, par membre, le nombre d'appareils inscrits et leur
-- user-agent — sans jamais exposer les colonnes sensibles (endpoint, clés
-- p256dh/auth) au client. Utilisée par EquipeView.tsx pour afficher un
-- indicateur "Notifications push" dans la fiche de chaque membre.
create or replace function public.get_team_push_status(_agency_id uuid)
returns table (
  user_id uuid,
  device_count integer,
  last_updated timestamptz,
  user_agents text[]
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'
      and (ur.expires_at is null or ur.expires_at > now())
  ) then
    raise exception 'Accès réservé aux super admins';
  end if;

  return query
    select
      ps.user_id,
      count(*)::integer as device_count,
      max(ps.updated_at) as last_updated,
      array_agg(distinct ps.user_agent) as user_agents
    from public.push_subscriptions ps
    where ps.user_id in (
      select am.user_id from public.agency_members am where am.agency_id = _agency_id
    )
    group by ps.user_id;
end;
$function$;

grant execute on function public.get_team_push_status(uuid) to authenticated;
