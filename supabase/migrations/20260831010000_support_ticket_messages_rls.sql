-- FAILLE CORRIGÉE ICI — trouvée lors de l'audit du 31/08/2026.
--
-- `support_ticket_messages` était la seule table sur 102 accessible sans
-- aucune session : avec la clé publique du navigateur, n'importe qui sur
-- Internet pouvait
--   • LIRE l'intégralité des échanges de support (16 messages, avec le nom
--     de leurs auteurs) ;
--   • ÉCRIRE dans n'importe quel ticket, en réutilisant un `sender_id` lu
--     dans cette même table — donc en se faisant passer pour un membre de
--     l'équipe. Vérifié : l'insertion anonyme aboutissait.
--
-- Les 101 autres tables refusaient bien tout accès anonyme. Celle-ci n'avait
-- simplement jamais reçu de politique.
--
-- Portée retenue : la même que le ticket lui-même — ses messages ne sont
-- visibles que par les membres de l'agence du ticket, et un message ne peut
-- être écrit qu'en son propre nom.

alter table public.support_ticket_messages enable row level security;

drop policy if exists "support_messages: lecture par l'agence du ticket" on public.support_ticket_messages;
create policy "support_messages: lecture par l'agence du ticket"
on public.support_ticket_messages
for select to authenticated
using (
  exists (
    select 1
    from public.support_tickets t
    join public.agency_members m on m.agency_id = t.agency_id
    where t.id = support_ticket_messages.ticket_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "support_messages: ecriture en son propre nom" on public.support_ticket_messages;
create policy "support_messages: ecriture en son propre nom"
on public.support_ticket_messages
for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.support_tickets t
    join public.agency_members m on m.agency_id = t.agency_id
    where t.id = support_ticket_messages.ticket_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "support_messages: modifier ses propres messages" on public.support_ticket_messages;
create policy "support_messages: modifier ses propres messages"
on public.support_ticket_messages
for update to authenticated
using (sender_id = auth.uid())
with check (sender_id = auth.uid());

drop policy if exists "support_messages: supprimer ses propres messages" on public.support_ticket_messages;
create policy "support_messages: supprimer ses propres messages"
on public.support_ticket_messages
for delete to authenticated
using (sender_id = auth.uid());
