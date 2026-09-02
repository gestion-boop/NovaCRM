-- ─────────────────────────────────────────────────────────────────────────
-- Suppression d'une fiche client par les membres de l'agence.
--
-- Signalé le 2 septembre : « il faut que les utilisateurs puissent supprimer
-- des clients avec la poubelle » et « impossible de supprimer les dossiers en
-- cours en passant par le pipeline ».
--
-- Le bouton fonctionnait : c'est la base qui refusait. Et un refus RLS sur un
-- DELETE ne produit AUCUNE erreur — la requête réussit, simplement zéro ligne
-- n'est supprimée. D'où un clic sans effet, sans le moindre message. Le CRM
-- détecte désormais ce cas et l'affiche (voir useContacts / useDeals) ; il
-- reste à ouvrir le droit lui-même, ce que fait cette migration.
--
-- PORTÉE VOLONTAIREMENT ÉTROITE : seul un membre déclaré de l'agence dans
-- `agency_members` peut supprimer une fiche DE CETTE AGENCE. Un client
-- invité (client_guest), qui n'est membre d'aucune agence, ne peut donc rien
-- supprimer, et personne ne peut toucher aux fiches d'une autre agence.
--
-- ⚠️ À N'APPLIQUER QUE SI le message « Suppression refusée par la base de
-- données » apparaît réellement dans le CRM : si les suppressions échouent
-- pour une autre raison (contrainte de clé étrangère sur une table liée),
-- cette policy ne changera rien et il faudra regarder l'erreur exacte.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists "leads: suppression par les membres de l'agence" on public.leads;

create policy "leads: suppression par les membres de l'agence" on public.leads
for delete to authenticated
using (
  exists (
    select 1 from public.agency_members m
    where m.user_id = auth.uid() and m.agency_id = leads.agency_id
  )
);
