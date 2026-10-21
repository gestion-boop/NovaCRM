-- Lire une notification sur un appareil doit la retirer des autres.
-- Sans identité de réplique complète, un UPDATE (is_read, dismissed_at)
-- n'emporte pas user_id : le filtre temps réel `user_id=eq.…` ne livre
-- pas l'événement, et les autres appareils gardent la pastille jusqu'au
-- sondage. L'INSERT, lui, fonctionnait déjà.
alter table public.notifications replica identity full;
