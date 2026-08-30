-- Audit général ("effets instantanés" : notifications, emoji, chat) : les
-- réactions emoji sur les messages en conversation directe (table
-- `message_reactions`) ne se propageaient jamais en direct à l'autre
-- participant — réagir sans envoyer de nouveau message restait invisible
-- pour lui tant qu'il ne rouvrait pas la conversation. Le code client
-- écoute désormais cette table (voir ChatViewSupabase.tsx), mais Postgres
-- ne pousse un évènement realtime QUE pour les tables explicitement
-- ajoutées à la publication `supabase_realtime` — jamais faite pour cette
-- table (créée hors de l'historique de migrations de ce dépôt).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
