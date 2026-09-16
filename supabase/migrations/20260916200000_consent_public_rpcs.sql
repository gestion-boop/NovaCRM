-- Signalé (16 septembre) : « Lien invalide ou déjà utilisé » systématique
-- en cliquant sur le lien de consentement reçu par email.
--
-- Cause trouvée : la page publique (PublicConsentement.tsx) appelle
-- get_questionnaire_by_token / submit_questionnaire, en pensant (voir son
-- propre commentaire, faux) qu'elles sont génériques — en réalité les deux
-- sont câblées en dur sur la table `credit_questionnaires`. Le consentement
-- est lui écrit dans une table DIFFÉRENTE, `confidential_questionnaires`
-- (kind='consent') — le token n'y est donc jamais trouvé, systématiquement,
-- depuis la création de la fonctionnalité.
--
-- Deux RPC dédiées au consentement plutôt que de toucher aux RPC
-- existantes (utilisées ailleurs pour le questionnaire crédit, qui
-- fonctionne) : aucun risque de régression sur ce qui marche déjà.
create or replace function public.get_consent_by_token(p_token text)
returns table(
  id uuid, lead_id uuid, sent_to_email text, sent_by uuid,
  agency_id uuid, lead_name text
)
language sql
security definer
set search_path to 'public'
as $$
  select q.id, q.lead_id, q.sent_to_email, q.created_by, q.agency_id, l.full_name
  from confidential_questionnaires q
  left join leads l on l.id = q.lead_id
  where q.token = p_token
    and q.kind = 'consent'
    and q.submitted_at is null
    and (q.expires_at is null or q.expires_at > now());
$$;

create or replace function public.submit_consent(p_token text, p_answers jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated int;
begin
  update confidential_questionnaires
  set data = p_answers, submitted_at = now(), updated_at = now()
  where token = p_token
    and kind = 'consent'
    and submitted_at is null
    and (expires_at is null or expires_at > now());
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Page publique non authentifiée (client qui signe) — même droit d'exécution
-- que get_questionnaire_by_token/submit_questionnaire (existant, vérifié).
grant execute on function public.get_consent_by_token(text) to anon, authenticated;
grant execute on function public.submit_consent(text, jsonb) to anon, authenticated;
