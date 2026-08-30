-- Cause racine du bug "le compteur ne s'enlève pas après lecture" : la
-- table message_receipts n'avait NI policy INSERT, ni WITH CHECK sur la
-- policy SELECT permettant à un utilisateur d'insérer sa propre ligne
-- d'accusé de réception. Le code client (ChatViewSupabase.tsx) marque un
-- message lu via un upsert (INSERT ... ON CONFLICT DO UPDATE) — Postgres
-- exige la policy INSERT même quand la ligne existe déjà et que
-- l'opération finit en UPDATE (le conflit n'est résolu qu'après
-- vérification du droit d'insertion). Sans elle, l'upsert échouait
-- systématiquement avec une erreur RLS 42501 — jamais remontée côté client
-- (l'erreur du upsert n'était pas vérifiée), donc totalement silencieuse.
create policy "Receipts: self insert"
on public.message_receipts
for insert
to authenticated
with check (user_id = auth.uid());
