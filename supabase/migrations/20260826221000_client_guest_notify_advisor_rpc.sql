-- Suite du correctif précédent (20260826220000) : même après être passé
-- par une fonction SECURITY DEFINER pour la condition du EXISTS, l'INSERT
-- direct du client dans `notifications` continuait d'échouer par
-- intermittence avec "new row violates row-level security policy" — testé
-- empiriquement 5 fois de suite, échec systématique après le correctif,
-- malgré un appel RPC direct à la fonction renvoyant bien `true`. La cause
-- exacte n'a pas pu être isolée avec certitude (comportement d'évaluation
-- de policy imbriquée peu documenté), mais le reste de l'application ne
-- crée JAMAIS de notification par un INSERT direct — toujours via la RPC
-- `create_notification` (SECURITY DEFINER, qui contourne entièrement le
-- RLS de la table puisqu'elle appartient à un rôle privilégié, et
-- déclenche en prime la notification push). On aligne donc le client
-- invité sur ce même chemin, déjà fiable et déjà utilisé partout ailleurs
-- dans le CRM, plutôt que de continuer à dépendre d'une policy RLS
-- récalcitrante.
--
-- Sécurité : contrairement à `create_notification` (qui accepte n'importe
-- quel _user_id cible, réservé aux appelants déjà de confiance — équipe
-- CRM), cette fonction ne reçoit AUCUN identifiant de destinataire du
-- client : elle résout elle-même, côté serveur, le conseiller assigné à
-- SA PROPRE fiche via `client_guest_access` — impossible pour un client
-- invité de notifier qui que ce soit d'autre que son propre conseiller.
create or replace function public.client_guest_notify_advisor(
  p_title text,
  p_body text,
  p_link text default '/',
  p_entity_type text default 'lead',
  p_entity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _advisor_id uuid;
  _agency_id uuid;
  _lead_id uuid;
  _id uuid;
begin
  select l.assigned_to, ga.agency_id, ga.lead_id
    into _advisor_id, _agency_id, _lead_id
  from public.client_guest_access ga
  join public.leads l on l.id = ga.lead_id
  where ga.user_id = auth.uid()
    and ga.status in ('active', 'envoyee')
  limit 1;

  -- Pas de conseiller assigné (ou appelant qui n'est pas un client invité
  -- actif) : rien à notifier, mais on ne fait jamais échouer l'envoi du
  -- message du client pour autant.
  if _advisor_id is null then
    return null;
  end if;

  _id := public.create_notification(
    _advisor_id,
    'client_message',
    p_title,
    p_body,
    p_entity_type,
    coalesce(p_entity_id, _lead_id),
    _agency_id,
    jsonb_build_object('url', coalesce(p_link, '/'))
  );

  return _id;
end;
$$;

grant execute on function public.client_guest_notify_advisor(text, text, text, text, uuid) to authenticated;
