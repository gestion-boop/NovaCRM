-- Questionnaire confidentiel (crédit) reçu : prévenir l'expéditeur dans la clochette
-- (+ push), avec un lien qui ouvre directement le questionnaire sur la fiche client.
-- Jusqu'ici seul `confidential_questionnaires` (consentement) notifiait ;
-- `credit_questionnaires` (envoyé depuis la fiche client) ne prévenait personne.

create or replace function public.tg_credit_questionnaire_notify_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fonction$
declare
  _nom   text;
  _titre text;
  _corps text;
  _lien  text;
begin
  if new.status is distinct from 'completed' or old.status = 'completed' then
    return new;
  end if;
  if new.sent_by is null
     or not exists (select 1 from public.profiles where id = new.sent_by) then
    return new;
  end if;

  select coalesce(nullif(full_name, ''), 'Le client') into _nom
    from public.leads where id = new.lead_id;
  _nom   := coalesce(_nom, 'Le client');
  _titre := 'Questionnaire confidentiel reçu';
  _corps := _nom || ' a rempli son questionnaire confidentiel.';
  _lien  := '/clients/' || new.lead_id::text || '?tab=questionnaire&questionnaire=' || new.id::text;

  begin
    insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, agency_id, is_read)
    values (new.sent_by, 'confidential_questionnaire_completed', _titre, _corps, _lien,
            'credit_questionnaire', new.id, new.agency_id, false);
  exception when others then
    raise warning 'Notification questionnaire reçu échouée : %', sqlerrm;
  end;

  begin
    perform public.invoke_send_push(array[new.sent_by], _titre, _corps, _lien, 'cquest-' || new.id::text);
  exception when others then
    raise warning 'Push questionnaire reçu échoué : %', sqlerrm;
  end;

  return new;
end;
$fonction$;

drop trigger if exists trg_credit_questionnaire_notify_completed on public.credit_questionnaires;
create trigger trg_credit_questionnaire_notify_completed
  after update of status on public.credit_questionnaires
  for each row execute function public.tg_credit_questionnaire_notify_completed();
