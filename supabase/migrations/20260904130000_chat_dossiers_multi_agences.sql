-- Chat Équipe : dossiers multi-agences (super admin) + sous-dossiers.
--
-- Signalé : « dans Immosphera, je ne peux pas inviter les autres équipes »
-- dans un dossier (chat_projects/chat_channels). Ces deux tables ne sont
-- suivies par aucune migration de ce dépôt (créées directement en base,
-- comme scheduled_messages avant elles) — leurs policies RLS exactes sont
-- donc inconnues d'ici. On ne les remplace pas : une policy RLS
-- supplémentaire du même type (INSERT/SELECT) s'ajoute aux existantes par
-- un OU logique — elle ne peut qu'ÉLARGIR l'accès, jamais le restreindre
-- par erreur, même sans connaître le nom des policies déjà en place.

-- Sous-dossiers : un canal peut désormais avoir un canal parent. Nullable,
-- donc aucun effet sur les canaux existants (tous restent des canaux
-- racine, rendu strictement identique à aujourd'hui).
alter table public.chat_channels
  add column if not exists parent_channel_id uuid references public.chat_channels(id) on delete cascade;

-- Un super admin peut ajouter n'importe quel utilisateur à n'importe quel
-- dossier, quelle que soit l'agence de l'un ou de l'autre. Un dossier
-- "3 Entités" (agency_id null, déjà le principe utilisé par
-- chat_projects/chat_channels pour cet espace partagé) reste ouvert à
-- tous, même règle que conversations/conversation_members (migration
-- 20260829121000_cross_agency_conversations.sql).
create policy "Super admin or shared-space adds project member"
  on public.chat_project_members
  for insert
  with check (
    has_role(auth.uid(), 'super_admin'::app_role)
    or exists (
      select 1 from public.chat_projects p
      where p.id = chat_project_members.project_id
        and p.agency_id is null
    )
  );

-- Un utilisateur voit aussi un dossier dont il est déjà membre, même s'il
-- appartient à une agence différente de celle du dossier (sans quoi
-- l'ajout ci-dessus resterait invisible pour la personne invitée).
create policy "Members see their own project regardless of agency"
  on public.chat_projects
  for select
  using (
    exists (
      select 1 from public.chat_project_members m
      where m.project_id = chat_projects.id
        and m.user_id = auth.uid()
    )
  );
