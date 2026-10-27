-- Migration : Renommage sécurisé de dossiers de chat pour Sylvain et Mélanie
-- Permet à Sylvain et Mélanie (administrateurs) de renommer n'importe quel dossier
-- y compris le dossier partagé "Les 3 agences" (ex: pour l'écrire en MAJUSCULES).

CREATE OR REPLACE FUNCTION public.rename_chat_project(_project_id uuid, _new_name text)
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
  v_cleaned_name text;
BEGIN
  IF _project_id IS NULL THEN
    RAISE EXCEPTION 'ID de dossier requis.';
  END IF;

  v_cleaned_name := TRIM(_new_name);
  IF v_cleaned_name IS NULL OR length(v_cleaned_name) = 0 THEN
    RAISE EXCEPTION 'Le nom du dossier ne peut pas être vide.';
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
    RAISE EXCEPTION 'Seuls Sylvain et Mélanie peuvent renommer des dossiers.';
  END IF;

  UPDATE public.chat_projects
     SET name = v_cleaned_name
   WHERE id = _project_id;

  RETURN true;
END;
$$;
