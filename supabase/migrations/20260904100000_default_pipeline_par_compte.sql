-- ─────────────────────────────────────────────────────────────────────────
-- Pipeline « par défaut » : la préférence suit le compte, pas le navigateur.
--
-- Signalé : « quand dans Pipelines on met par défaut, souvent cela ne
-- s'enregistre pas ». En creusant (Pipeline.tsx) : le pipeline par défaut
-- choisi via l'étoile n'était enregistré que dans le localStorage du
-- navigateur (novasphere_default_pipeline_<uid>_<agencyId>) — jamais
-- restauré sur un autre appareil ou navigateur, perdu en navigation
-- privée ou si les données du site sont effacées. Exactement le même
-- symptôme, pour la même raison, que les tuiles masquées de l'accueil
-- (migration 20260902210000) : la préférence rejoint donc les réglages du
-- compte, en dictionnaire par agence comme `home_tiles`.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.user_ui_settings
  add column if not exists default_pipelines jsonb not null default '{}'::jsonb;

comment on column public.user_ui_settings.default_pipelines is
  'Pipeline par défaut choisi par l''utilisateur, par agence : { [agencyId]: pipelineId }. Suit le compte, pas le navigateur.';
