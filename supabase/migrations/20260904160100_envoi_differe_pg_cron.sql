-- Envoi différé, 2/2 : le passage automatique, par pg_cron.
--
-- À exécuter APRÈS 20260904160000_envoi_differe_sans_service_externe.sql, et
-- seulement une fois que l'appel à la main a fonctionné :
--     select public.envoyer_messages_programmes();
--
-- Ce fichier est volontairement séparé : si l'extension pg_cron n'est pas
-- disponible sur ce projet, ce script échoue — et la fonction du premier
-- fichier, elle, reste installée et utilisable.
--
-- pg_cron tourne DANS la base : plus de service externe à héberger, plus de
-- secret à transmettre, plus de fonction Edge à redéployer. C'est ce qui
-- manquait depuis le début.
--
-- Si la première ligne échoue avec « permission denied » ou « extension is
-- not available » : Supabase → Database → Extensions → activer `pg_cron`
-- dans l'interface, puis relancer ce fichier à partir de la deuxième ligne.

create extension if not exists pg_cron;

-- Toutes les 5 minutes. Un message programmé part donc au plus tard cinq
-- minutes après l'heure demandée (au lieu d'un quart d'heure avec l'ancien
-- passage externe, quand il tournait).
--
-- `unschedule` d'abord : rejouer ce fichier ne crée pas de doublon.
select cron.unschedule('envoi-messages-programmes')
 where exists (select 1 from cron.job where jobname = 'envoi-messages-programmes');

select cron.schedule(
  'envoi-messages-programmes',
  '*/5 * * * *',
  $tache$ select public.envoyer_messages_programmes(); $tache$
);

-- Vérification : la tâche doit apparaître, active.
--   select jobname, schedule, active from cron.job where jobname = 'envoi-messages-programmes';
-- Et son journal, après quelques minutes :
--   select status, return_message, start_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'envoi-messages-programmes')
--    order by start_time desc limit 5;
