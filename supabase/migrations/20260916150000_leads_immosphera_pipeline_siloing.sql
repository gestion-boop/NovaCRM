-- Demande explicite (16 septembre) : « je voudrais que tu cloisonnes les
-- pipelines par utilisateur, sauf les admin qui peuvent tous les voir. Je
-- voudrais que tu laisses pour l'instant la transaction V2, pour tous les
-- utilisateurs à la vue. » — pour l'agence Immosphera.
--
-- Aujourd'hui, la policy "leads: lecture par les membres de l'agence" est
-- agence-large : n'importe quel membre d'une agence voit TOUS les dossiers
-- de l'agence, quel que soit le pipeline. Seul le pipeline "Transactions
-- V2" avait une restriction — mais purement côté client (Pipeline.tsx),
-- donc sans réelle protection : un appel direct à l'API Supabase pouvait
-- lire n'importe quel dossier de l'agence, commissions et coordonnées
-- bancaires comprises.
--
-- Ce correctif inverse la logique ET la rend réelle (RLS, pas un filtre
-- d'affichage) : pour Immosphera uniquement, un dossier n'est visible via
-- cette policy agence-large que s'il appartient à "Pipeline Transactions
-- V2" (laissé pour l'instant ouvert à tous) OU si l'utilisateur a le rôle
-- admin. Sur tout autre pipeline Immosphera, un utilisateur non-admin ne
-- voit plus que ses propres dossiers via l'autre policy déjà existante
-- ("Owner assignee guest views leads" : created_by/assigned_to/super_admin).
-- Les autres agences ne sont pas concernées (première branche du OR).
drop policy if exists "leads: lecture par les membres de l'agence" on public.leads;
create policy "leads: lecture par les membres de l'agence"
  on public.leads for select
  using (
    agency_id is not null
    and is_agency_member(auth.uid(), agency_id)
    and (
      agency_id <> '15157da9-71ea-4760-ae1c-3bc99d9caa20'::uuid
      or pipeline_id = '8f79d05c-d191-43bb-8323-bedbd722f9f2'::uuid
      or has_role(auth.uid(), 'admin'::app_role)
    )
  );
