-- Décision de la banque sur un dossier (Conseils Finances) : colore la carte du pipeline.
alter table public.leads add column if not exists decision_banque text;
alter table public.leads drop constraint if exists leads_decision_banque_check;
alter table public.leads add constraint leads_decision_banque_check
  check (decision_banque is null or decision_banque in ('accord','refus','refus_accord_travail'));
