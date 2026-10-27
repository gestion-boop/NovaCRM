-- Migration : Suppression sécurisée de dossiers de chat pour Sylvain et Mélanie
-- Permet à Sylvain et Mélanie (administrateurs) de supprimer un dossier de chat
-- en nettoyant en cascade ses canaux, membres et messages associés.
-- Le dossier "Les 3 agences" est strictement protégé contre toute suppression.

CREATE OR REPLACE FUNCTION public.delete_chat_project(_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_email text;
  v_name text;
  v_is_admin boolean := false;
  v_is_special boolean := false;
BEGIN
  IF _project_id IS NULL THEN
    RAISE EXCEPTION 'ID de dossier requis.';
  END IF;

  -- Vérification des droits : Sylvain, Mélanie, super_admin ou admin
  SELECT role, email, full_name INTO v_role, v_email, v_name
    FROM public.profiles
   WHERE id = v_caller;

  IF v_role IN ('super_admin', 'admin')
     OR v_caller = '15bcec53-de3e-40b8-8b7e-bb6874836f29' -- Mélanie
     OR v_caller = '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29' -- Sylvain
     OR COALESCE(v_email, '') ~* 'sylvain|m[eé]lanie'
     OR COALESCE(v_name, '') ~* 'sylvain|m[eé]lanie' THEN
    v_is_admin := true;
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Seuls Sylvain et Mélanie peuvent supprimer des dossiers.';
  END IF;

  -- Protection absolue du dossier "Les 3 agences"
  SELECT (agency_id IS NULL OR name ILIKE '%3 agences%') INTO v_is_special
    FROM public.chat_projects
   WHERE id = _project_id;

  IF v_is_special THEN
    RAISE EXCEPTION 'Le dossier des 3 agences ne peut pas être supprimé.';
  END IF;

  -- 1. Messages des canaux du projet
  DELETE FROM public.chat_messages
   WHERE channel IN (SELECT id FROM public.chat_channels WHERE project_id = _project_id);

  -- 2. Membres des canaux du projet
  DELETE FROM public.chat_channel_members
   WHERE channel_id IN (SELECT id FROM public.chat_channels WHERE project_id = _project_id);

  -- 3. Canaux du projet
  DELETE FROM public.chat_channels
   WHERE project_id = _project_id;

  -- 4. Membres du projet
  DELETE FROM public.chat_project_members
   WHERE project_id = _project_id;

  -- 5. Le projet / dossier lui-même
  DELETE FROM public.chat_projects
   WHERE id = _project_id;

  RETURN true;
END;
$$;
