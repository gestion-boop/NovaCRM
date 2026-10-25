-- Signalé en revue (25 octobre, chasse aux bugs) : la date de fin d'accès
-- d'un stagiaire (user_roles.expires_at) n'était vérifiée que côté client
-- (AuthContext, au moment de la connexion) et dans /api/settings/bootstrap
-- (voir le commit précédent sur cette même date). Mais is_agency_member,
-- utilisée par la quasi-totalité des policies RLS du CRM (leads, contacts,
-- tâches...), ne regardait QUE la table agency_members : un stagiaire reste
-- membre de son agence indépendamment de l'expiration de son rôle (rien ne
-- retire sa ligne agency_members à l'échéance). Avec un jeton Supabase
-- encore valide (le JWT n'est pas révoqué par la seule expiration du rôle),
-- il pouvait donc continuer à interroger PostgREST directement et garder un
-- accès complet aux données de son agence bien après la fin de son stage.
--
-- has_role() vérifiait déjà expires_at — seule is_agency_member() ne le
-- faisait pas. Elle exige maintenant aussi que l'utilisateur ait un rôle
-- (quel qu'il soit) non expiré, en plus d'être membre de l'agence. Vérifié
-- avant application : tous les membres actuels d'une agence ont une ligne
-- user_roles, la plupart avec expires_at = null (jamais concernés par ce
-- changement) ; seule la stagiaire actuelle (expires_at: 2026-10-31) sera
-- bloquée à cette date, comme voulu.
CREATE OR REPLACE FUNCTION public.is_agency_member(_user_id uuid, _agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.agency_members
      WHERE user_id = _user_id AND agency_id = _agency_id
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id
        AND (expires_at IS NULL OR expires_at > now())
    )
  ) OR public.has_role(_user_id, 'super_admin')
$function$;
