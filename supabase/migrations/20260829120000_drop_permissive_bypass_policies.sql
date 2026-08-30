-- Audit "cloisonnement par entité" (29/08/2026) : en vérifiant l'isolation
-- par agence, trois tables se sont révélées avoir DEUX jeux de policies RLS
-- actifs en même temps pour insert/update/delete : un jeu correctement
-- restreint (propriétaire / membre de l'agence / lié au dossier...) ET un
-- vieux jeu "*_authenticated" bien plus large (qual/with_check = true),
-- probablement des policies de scaffolding jamais retirées après coup.
--
-- En PostgreSQL RLS, plusieurs policies PERMISSIVE pour la même commande se
-- combinent en OR : la présence d'une policy "true" rend donc les policies
-- plus strictes sans effet — n'importe quel utilisateur authentifié peut
-- alors modifier/supprimer n'importe quelle ligne de n'importe qui d'autre,
-- sur documents, notes et note_folders. Aucun cas d'usage légitime ne
-- justifie ces policies "*_authenticated" : elles sont supprimées ici, les
-- policies réellement restrictives (propriétaire, agence, dossier partagé)
-- restent seules en vigueur.

drop policy if exists "documents_delete_authenticated" on public.documents;
drop policy if exists "documents_insert_authenticated" on public.documents;
drop policy if exists "documents_update_authenticated" on public.documents;

drop policy if exists "note_folders_delete_authenticated" on public.note_folders;
drop policy if exists "note_folders_insert_authenticated" on public.note_folders;
drop policy if exists "note_folders_update_authenticated" on public.note_folders;

drop policy if exists "notes_delete_authenticated" on public.notes;
drop policy if exists "notes_insert_authenticated" on public.notes;
drop policy if exists "notes_update_authenticated" on public.notes;

-- note_folders n'avait par ailleurs AUCUNE policy insert/update/delete
-- restrictive derrière ces policies larges (contrairement à documents/
-- notes) — on lui donne les mêmes règles "propriétaire uniquement" que
-- notes, plutôt que de le laisser sans aucune policy d'écriture après ce
-- nettoyage (ce qui bloquerait tout le monde, y compris le propriétaire).
create policy "Users insert own folders"
  on public.note_folders for insert
  with check (user_id = auth.uid());

create policy "Users update own folders"
  on public.note_folders for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete own folders"
  on public.note_folders for delete
  using (user_id = auth.uid());
