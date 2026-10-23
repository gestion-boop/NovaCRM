-- Demande explicite (24/09/2026) : « dans les conversations des chats, je
-- veux que chaque utilisateur puisse inviter des utilisateurs de
-- Immosphera, Conseils Finances et Novavisio, et pour tous, et inviter
-- plusieurs utilisateurs si possible ».
--
-- Deux blocages trouvés en base, distincts de l'interface (traitée côté
-- client dans ChatViewSupabase.tsx) :
--
-- 1) `is_conversation_member` exige `agency_id IS NOT NULL` — une
--    conversation "3 entités" (agency_id NULL, le principe déjà en place
--    depuis le 29/08/2026 pour les groupes multi-agences) ne reconnaît donc
--    PERSONNE comme membre, pas même son créateur : invisible pour tout le
--    monde (conversations, messages, réactions...), silencieusement. 9
--    conversations existantes sont concernées à ce jour, dont une avec 39
--    messages. Corrigé pour retrouver le principe d'origine : agency_id
--    NULL = pas de restriction d'agence, seule l'appartenance à
--    `conversation_members` compte (comme is_agency_member et les policies
--    "Members create/view conversations" le documentaient déjà en
--    commentaire, sans que la fonction elle-même ne le fasse).
--
-- 2) L'ajout d'un participant (`conversation_members` insert) n'était
--    autorisé qu'à SOI-MÊME ou au CRÉATEUR de la conversation
--    (`est_auteur_conversation`) — un simple membre d'un groupe ne pouvait
--    inviter personne d'autre. Élargi à tout membre déjà présent.
--
-- Sans (1), un groupe qu'on ouvre à une autre agence (agency_id mis à NULL
-- côté client pour accueillir un invité hors agence, voir
-- inviteToConversation) redeviendrait invisible pour tout le monde, y
-- compris les membres déjà là — d'où le correctif conjoint.

create or replace function public.is_conversation_member(_user_id uuid, _conversation_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.user_id = _user_id
      and cm.conversation_id = _conversation_id
      and (c.agency_id is null or public.is_agency_member(_user_id, c.agency_id))
  );
$function$;

-- L'ancien nom a déjà été remplacé par "Members add participants" le 29/08.
-- Supprimer les deux variantes évite le conflit de nom sur une base déjà migrée.
drop policy if exists "Members add participants from same entity" on public.conversation_members;
drop policy if exists "Members add participants" on public.conversation_members;
create policy "Members add participants"
  on public.conversation_members for insert
  with check (
    public.est_auteur_conversation(conversation_id, auth.uid())
    or public.is_conversation_member(auth.uid(), conversation_id)
  );

-- Ouvrir une conversation aux "3 entités" (agency_id -> NULL) au moment
-- d'inviter quelqu'un d'une autre agence : jusqu'ici réservé au créateur ou
-- au super admin (policy "Creator updates entity conversation"), désormais
-- permis à tout membre — mais SEULEMENT pour cette transition précise vers
-- NULL (jamais vers une autre agence) ; le créateur/super admin gardent
-- seuls la main sur le reste (titre...) via la policy existante.
create policy "Members open conversation to all entities"
  on public.conversations for update
  using (is_conversation_member(auth.uid(), id))
  with check (agency_id is null);
