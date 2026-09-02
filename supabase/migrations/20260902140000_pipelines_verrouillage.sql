-- ─────────────────────────────────────────────────────────────────────────
-- Verrouillage d'un pipeline — demandé le 2 septembre.
--
-- « Pour les pipelines des utilisateurs, c'est leur pipeline qu'ils pourront
--   modifier uniquement ; à la limite, peut-être trouver une solution que je
--   peux verrouiller des pipelines quand elles sont créées. »
--
-- Deux protections complémentaires, et aucune ne repose sur l'interface :
--
--   `owner_id`  (colonne déjà présente) : qui a créé le pipeline. Un
--               utilisateur ne peut renommer ou supprimer QUE les siens.
--               Elle n'était jamais renseignée à la création — c'est corrigé
--               côté application, mais les pipelines existants gardent NULL
--               et restent donc réservés aux super admins.
--
--   `locked`    (nouvelle) : posée par un super admin sur n'importe quel
--               pipeline, y compris celui d'un autre. Un pipeline verrouillé
--               ne se renomme ni ne se supprime, sauf par un super admin.
--
-- Le pipeline marqué `is_default` (le pipeline officiel de la société) est
-- protégé de la même manière, sans avoir besoin d'être verrouillé à la main.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.pipelines
  add column if not exists locked boolean not null default false;

comment on column public.pipelines.locked is
  'Pipeline verrouillé par un super admin : ni renommable ni supprimable par les autres membres.';
